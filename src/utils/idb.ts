import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { PlanningAgent } from "../agent/planning";

interface PlanRecord {
  key: string | number;
  content: {
    uuid: string;
    [key: string]: unknown;
  };
}

interface ContentRecord {
  planId: string;
  [key: string]: unknown;
}

interface MessagesDBSchema extends DBSchema {
  plan: {
    key: number;
    value: PlanRecord;
    indexes: {
      key: number;
    };
  };
  content: {
    key: number;
    value: ContentRecord;
    indexes: {
      planId: string;
      ["planId-type"]: [string, string];
    };
  };
  version: {
    key: number;
    value: VersionRecord;
    indexes: {
      sessionKey: number;
      "sessionKey-uuid": [number, string];
    };
  };
}

export interface VersionRecord {
  /** 绑定 idb.key，隔离不同实例 */
  sessionKey: number;
  /** 调用方传入的版本唯一标识 */
  uuid: string;
  /** 调用方传入的任意版本数据，不限结构 */
  data: Record<string, unknown>;
}

export interface CompactionRecord {
  /** 已压缩的历史摘要文本 */
  summary: string;
  /** 已压缩的 agent uuid 列表 */
  summarizedUuids: string[];
  /** 自上次压缩/清除以来记录到的上下文 token 峰值 */
  peakTokens: number;
}

interface IDBOptions {
  dbName: string;
  key: number;
}

class IDB {
  private key: number;
  private dbPromise: Promise<IDBPDatabase<MessagesDBSchema>>;

  constructor(options: IDBOptions) {
    this.dbPromise = this.init(options.dbName);
    this.key = options.key;
  }

  getDB() {
    return this.dbPromise;
  }

  getKey() {
    return this.key;
  }

  private async init(dbName: string) {
    return openDB<MessagesDBSchema>(dbName, 3, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("plan")) {
          const planStore = db.createObjectStore("plan", {
            autoIncrement: true,
          });
          planStore.createIndex("key", "key", { unique: false });
        }

        if (!db.objectStoreNames.contains("content")) {
          const contentStore = db.createObjectStore("content", {
            autoIncrement: true,
          });
          contentStore.createIndex("planId", "planId", {
            unique: false,
          });
          contentStore.createIndex("planId-type", ["planId", "type"], {
            unique: true,
          });
        }

        if (db.objectStoreNames.contains("version")) {
          // v2 → v3: drop old store with createdAt index, recreate with uuid index
          db.deleteObjectStore("version");
        }

        {
          const versionStore = db.createObjectStore("version", {
            autoIncrement: true,
          });
          versionStore.createIndex("sessionKey", "sessionKey", {
            unique: false,
          });
          versionStore.createIndex("sessionKey-uuid", ["sessionKey", "uuid"], {
            unique: true,
          });
        }
      },
    });
  }

  async addPlan(plan: PlanningAgent) {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction("plan", "readwrite");
      const store = tx.objectStore("plan");
      store.add({
        key: this.key,
        content: await plan.getDBContent(),
      });
    } catch (e) {
      console.error(e, plan);
    }
  }

  async getPlans() {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction("plan", "readonly");
      const store = tx.objectStore("plan");
      const index = store.index("key");
      const plans = await index.getAll(this.key);

      const contentTx = db.transaction("content", "readwrite");
      const contentStore = contentTx.objectStore("content");
      const id = `${this.key}-order`;
      const type = "order";
      const order = await contentStore.index("planId-type").get([id, type]);

      const result = await Promise.all(
        plans.map(async (plan) => {
          const {
            content: { uuid },
          } = plan;
          const tx = db.transaction("content", "readwrite");
          const store = tx.objectStore("content");
          const content = await store.index("planId").getAll(uuid);

          return { plan, content };
        }),
      );

      if (order) {
        return sortPlansByOrder(result, order.content as string[]);
      }

      return result;
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async putContent(content: { id: string; type: string; content: unknown }) {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction("content", "readwrite");
      const store = tx.objectStore("content");
      const { id, type, content: putContent } = content;
      const res = await store.index("planId-type").get([id, type]);
      const newRecord = {
        planId: id,
        type,
        content: putContent,
      };

      if (res) {
        const key = await store.index("planId-type").getKey([id, type])!;
        store.put(newRecord, key);
      } else {
        store.add(newRecord);
      }

      // 等待事务完成
      await tx.done;
    } catch (e) {
      console.error(e, content);
    }
  }

  async clear(planningAgents?: PlanningAgent[]) {
    // 清空所有对应当前key的plan数据，plan再根据uuid去匹配清空content
    const db = await this.dbPromise;

    // 同一个事务中同时操作 plan 与 content，确保数据一致性
    const tx = db.transaction(["plan", "content"], "readwrite");
    const planStore = tx.objectStore("plan");
    const contentStore = tx.objectStore("content");

    const planIndex = planStore.index("key");

    // 先拿到当前 key 下所有 plan 记录以及对应的主键
    const [plans, planPrimaryKeys] = await Promise.all([
      planIndex.getAll(this.key),
      planIndex.getAllKeys(this.key),
    ]);

    if (planningAgents) {
      const uuids = new Set(planningAgents.map((agent) => agent.id));
      const contentIndex = contentStore.index("planId");

      let index = 0;
      while (index < plans.length && uuids.size) {
        const {
          content: { uuid },
        } = plans[index];

        if (uuids.has(uuid)) {
          await planStore.delete(planPrimaryKeys[index]);
          const contentKeys = await contentIndex.getAllKeys(uuid);
          for (const key of contentKeys) {
            await contentStore.delete(key as number);
          }
          uuids.delete(uuid);
        }

        index++;
      }

      await tx.done;
      return;
    }

    // 删除 plan 记录
    for (const primaryKey of planPrimaryKeys) {
      await planStore.delete(primaryKey as number);
    }

    // 根据每个 plan 的 uuid，删除 content 中的关联记录
    for (const plan of plans) {
      const {
        content: { uuid },
      } = plan;

      const contentIndex = contentStore.index("planId");
      const contentKeys = await contentIndex.getAllKeys(uuid);

      for (const key of contentKeys) {
        await contentStore.delete(key as number);
      }
    }

    await tx.done;

    // 全量清空时同步清理 compaction 记录
    if (!planningAgents) {
      await this.clearCompaction();
    }
  }

  /** compaction 记录的 planId 标识（全局唯一，绑定当前 key） */
  private get compactionPlanId() {
    return `${this.key}-compaction`;
  }

  async getCompaction(): Promise<CompactionRecord | null> {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction("content", "readonly");
      const store = tx.objectStore("content");
      const record = await store
        .index("planId-type")
        .get([this.compactionPlanId, "compaction"]);
      return (record?.content as CompactionRecord) ?? null;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  async putCompaction(data: CompactionRecord): Promise<void> {
    await this.putContent({
      id: this.compactionPlanId,
      type: "compaction",
      content: data,
    });
  }

  async clearCompaction(): Promise<void> {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction("content", "readwrite");
      const store = tx.objectStore("content");
      const keys = await store
        .index("planId")
        .getAllKeys(this.compactionPlanId);
      for (const key of keys) {
        await store.delete(key as number);
      }
      await tx.done;
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * 写入一条版本记录，uuid 由调用方传入。
   */
  async addVersion(uuid: string, data: Record<string, unknown>): Promise<void> {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction("version", "readwrite");
      const store = tx.objectStore("version");

      await store.add({
        sessionKey: this.key,
        uuid,
        data,
      });

      await tx.done;
    } catch (e) {
      console.error(e, data);
    }
  }

  /**
   * 读取当前实例的所有版本记录。
   */
  async getVersions(): Promise<VersionRecord[]> {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction("version", "readonly");
      const store = tx.objectStore("version");
      return store.index("sessionKey").getAll(this.key);
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  /**
   * 保留指定数量的版本记录，删除多余的旧记录（按主键顺序）。
   */
  async trimVersions(keepCount: number): Promise<void> {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction("version", "readwrite");
      const store = tx.objectStore("version");

      const allKeys = await store.index("sessionKey").getAllKeys(this.key);

      const deleteCount = allKeys.length - keepCount;
      if (deleteCount > 0) {
        for (let i = 0; i < deleteCount; i++) {
          await store.delete(allKeys[i] as number);
        }
      }

      await tx.done;
    } catch (e) {
      console.error(e, keepCount);
    }
  }

  /**
   * 更新指定版本记录的 data 字段，通过 uuid 定位记录。
   */
  async updateVersion(
    uuid: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction("version", "readwrite");
      const store = tx.objectStore("version");

      const primaryKey = await store
        .index("sessionKey-uuid")
        .getKey([this.key, uuid]);

      if (primaryKey !== undefined) {
        await store.put({ sessionKey: this.key, uuid, data }, primaryKey);
      }

      await tx.done;
    } catch (e) {
      console.error(e, uuid);
    }
  }

  /**
   * 删除指定 uuid 及其之后的所有版本记录（按主键顺序）。
   */
  async deleteVersion(uuid: string): Promise<void> {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction("version", "readwrite");
      const store = tx.objectStore("version");

      const targetKey = await store
        .index("sessionKey-uuid")
        .getKey([this.key, uuid]);

      if (targetKey !== undefined) {
        const allKeys = await store.index("sessionKey").getAllKeys(this.key);
        for (const key of allKeys) {
          if ((key as number) >= (targetKey as number)) {
            await store.delete(key as number);
          }
        }
      }

      await tx.done;
    } catch (e) {
      console.error(e, uuid);
    }
  }

  async updateOrder(ids: string[]) {
    try {
      const db = await this.dbPromise;
      const tx = db.transaction("content", "readwrite");
      const store = tx.objectStore("content");
      const id = `${this.key}-order`;
      const type = "order";

      if (ids.length) {
        const res = await store.index("planId-type").get([id, type]);
        const newRecord = {
          planId: id,
          type,
          content: ids,
        };

        if (res) {
          const key = await store.index("planId-type").getKey([id, type])!;
          store.put(newRecord, key);
        } else {
          store.add(newRecord);
        }
      } else {
        const contentIndex = store.index("planId");
        const contentKeys = await contentIndex.getAllKeys(id);

        for (const key of contentKeys) {
          await store.delete(key as number);
        }
      }

      // 等待事务完成
      await tx.done;
    } catch (e) {
      console.error(e, ids);
    }
  }
}

export { IDB };

function sortPlansByOrder(
  plans: {
    plan: PlanRecord;
    content: ContentRecord[];
  }[],
  orderArray: string[],
) {
  const orderMap: Record<string, number> = {};
  orderArray.forEach((uuid, index) => {
    orderMap[uuid] = index;
  });

  return plans.sort((a, b) => {
    const indexA = orderMap[a.plan.content.uuid];
    const indexB = orderMap[b.plan.content.uuid];

    return indexA - indexB;
  });
}
