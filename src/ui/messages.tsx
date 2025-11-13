import * as React from 'react';
import css from './messages.less'

export interface MessagesProps {
  /** 当前聚焦消息uuid */
  uuid?: string;
}



export const Messages: React.FC<MessagesProps> = ({ uuid }) => {

  return (
    <div className={css.messages}>
      <div className={css.container}>
          <div className={css.header}>
          <span className={css.title}>我是智能助手</span>
          <span className={css.close}>—</span>
        </div>
        <div className={css.content}>
          <textarea className={css.textarea}>

          </textarea>
          <div className={css.send}>发送</div>
        </div>
      </div>
      
    </div>
  );
};