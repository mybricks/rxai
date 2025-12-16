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

  private async init(dbName: string) {
    return openDB<MessagesDBSchema>(dbName, 1, {
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
        content: plan.getDBContent(),
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
