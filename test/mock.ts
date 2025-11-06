export const MockPC = {
  gen: {
    focusRootComponentDoc: '',
    examples: `<example>
    <user_query>搭建一个云服务器管理中后台页面</user_query>
    <assistant_response>
      基于用户当前的选择上下文，我们来实现一个云服务器管理中后台页面，思考过程如下：

      任何时刻，必须先确认_root_的布局，根据需求，我们配置flex垂直布局；
      
      首先，这是一个典型的，左侧侧边，右边顶部 + 内容的中后台界面，我们首先来分析和设计页面级布局：
        整个页面可以从根组件上可以分为左右两个部分，左侧固定宽度，右侧自适应拉伸（从画布上体现则是1024 - 左侧宽度）。
        直接用grid组件来实现
          - 添加一个一行两列布局，左侧固定200宽度，右侧拉伸，同时配置合理的间距；
          - 自身设置height=fit-content适应flex内容的高度，宽度设置100%，方便画布宽度的调整；
          - 行列的间距使用子组件的margin来实现，左侧容器就设置了marginRight=12，不要遗漏；
      接下来，左右分别从上往下开始使用flex布局，按照从上往下的搭建方式进行搭建
        左侧从上往下，是Logo和网站信息 + 侧边栏
        - Logo和网站，图文编排，我们使用布局嵌套文本和图标
        - 侧边栏使用菜单组件配置
        右侧从上往下，需要配置每个区块的间距，其中从上往下分为三个部分
        - 顶部是个人信息，一些图文编排场景；
        - 中部是卡片概览，一行三列等分，我们使用一个自定义容器来均分三列；
        - 底部是表格，表格外使用自定义容器配置背景和圆角，内部使用表格配置多列，并且配置合理的分页信息

      \`\`\`json type="actions" file="云服务器管理页面生成步骤.json"
      ["_root_",":root","doConfig",{"path":"root/样式","style":{"background":"#f5f5f5"}}]
      ["_root_",":root","doConfig",{"path":"root/布局","value":{"display":"flex", "flexDirection": "column"}}]
      ["_root_","_rootSlot_","addChild",{"title": "页面布局", "ns": "mybricks.basic-comlib.antd5.grid", "comId": "u_page", "layout": {"width": "100%", "height": "fit-content"}, configs: [{"path": "常规/行列数据", "value": [{ "key": "row1", "cols": [{ "key": "col1", "width": 200 }, { "key": "col2", "width": "auto" }] }] }] }]
      ["u_page","col1","addChild",{"title":"左侧容器","ns":"mybricks.normal-pc.antd5.custom-container","comId":"u_left","layout":{"width":"100%","height":'fit-content',"marginRight":12},"configs":[{"path":"常规/布局","value":{"display":"flex", "flexDirection": "column"}}]}]
      ["u_left","content","addChild", Logo和网站]
      ["u_left","content","addChild", 侧边栏]
      ["u_page","col2","addChild",{"title":"右侧容器","ns":"mybricks.normal-pc.antd5.custom-container","comId":"u_right","layout":{"width":"100%","height":'fit-content'},"configs":[{"path":"常规/布局","value":{"display":"flex", "flexDirection": "column"}}]}]
      ["u_right","content","addChild", 顶部个人信息]
      ["u_right","content","addChild", 卡片概览]
      ["u_right","content","addChild", 底部表格]
      \`\`\`
    
    在上述内容中：
    我们遵循了以下关键事项：
    流程：从「根组件布局设计」-> 「考虑是否使用grid布局」-> 从上往下分区开始搭建内容。
    布局规则：
      1. 页面级布局，通过画布的宽度和grid组件完成了这类复杂页面布局；
      2. 注意容器从上往下排列时的margin间距；
    </assistant_response>
  </example>

  <example>
    <user_query>搭建一个博客详情页</user_query>
    <assistant_response>
      基于用户当前的选择上下文，我们来实现一个博客详情页面，思考过程如下：

      任何时刻，必须先确认_root_的布局，根据需求，我们配置flex垂直布局；
      
      首先，这是一个典型的，从上往下排列的页面，我们首先来分析和设计页面级布局：
        整个页面没有复杂的左右布局等，可以直接设置根组件的布局为flex垂直布局，同时配置合理的间距，从上往下一一实现即可
      接下来，从上往下开始搭建
        顶部导航，使用横向flex布局，嵌套左侧菜单和右侧头像昵称区域，其中：
          - 将左侧菜单设置自适应宽度width=100%，右侧头像昵称区域设置width=fit-content，保证整体为自适应效果；
          - 同时关注margin信息，左右的内容内容配置12间距，顶部导航组件配置下方的24间距；
        文档的详情内容，其中
          - 文章头部的高度设置fit-content，保证头部内容能完整展示；
          - 文章内容直接使用flex纵向布局，保证内容增长时容器变高；
        
      \`\`\`json type="actions" file="播客详情页面生成步骤.json"
      ["_root_",":root","doConfig",{"path":"root/样式","style":{"background":"#f5f5f5"}}]
      ["_root_",":root","doConfig",{"path":"root/布局","value":{"display":"flex", "flexDirection": "column"}}]
      ["_root_","_rootSlot_","addChild",{"title": "顶部导航", "ns": "mybricks.normal-pc.antd5.custom-container", "comId": "u_navs", "layout": {"width": "100%", "height": 60, "marginBottom": 24}, configs: [{"path":"常规/布局","value":{"display":"flex", "flexDirection": "row", "alignItems": "center", "justifyContent": "space-between"}}] }]
      ["u_navs","content","addChild", {"title": "左侧菜单", "ns": "菜单", "comId": "u_leftMenu", "layout": {"width": '100%', "height": 'fit-content', "marginLeft": 12}, configs: [] }]
      ["u_navs","content","addChild", {"title": "右侧头像昵称区域", "ns": "mybricks.normal-pc.antd5.custom-container", "comId": "u_rightProfile", "layout": {"width": 'fit-content', "height": '100%', "marginRight": 12}, configs: [{"path":"常规/布局","value":{"display":"flex", "flexDirection": "row", "alignItems": "center", "justifyContent": "flex-end"}}] }]
      ["_root_","_rootSlot_","addChild",{"title": "详情内容", "ns": "mybricks.normal-pc.antd5.custom-container", "comId": "u_detail", "layout": {"width": "100%", "height": 'fit-content', marginTop: 12, marginLeft: 12, marginRight: 12}, configs: [{"path":"常规/布局","value":{"display":"flex", "flexDirection": "column"}}] }]
      ["u_detail","content","addChild",{"title": "文章头部", "ns": "mybricks.normal-pc.antd5.custom-container", "comId": "u_header", "layout": {"width": "100%", "height": fit-content'}, configs: [{"path":"常规/布局","value":{"display":"flex", "flexDirection": "column"}}] }]
      ["u_detail","content","addChild",{"title": "文章内容", "ns": "mybricks.normal-pc.antd5.custom-container", "comId": "u_header", "layout": {"width": "100%", "height": 'fit-content', marginTop: 20}, configs: [{"path":"常规/布局","value":{"display":"flex", "flexDirection": "column"}}] }]
      // ...
      \`\`\`
    
    在上述内容中：
    我们遵循了以下关键事项：
    流程：从「根组件布局设计」-> 「考虑是否使用grid布局」-> 从上往下开始搭建内容。
    布局规则：
      1. 给每一个容器显式声明布局，同时合理使用 flex布局 和 height=fit-content；
      2. 注意各类margin间距，顶部导航和下方详情内容是有间距的；
      3. 顶部导航往往内容垂直居中，配置alignItems=center 同时考虑画布大小，如果内容过多，内容要斟酌使用width=100%来自适应宽度；
    </assistant_response>
  </example>

  <example>
    <user_query>添加一个一行三列的导航</user_query>
    <assistant_response>
      好的，一行三列的导航考察的是我们布局的关键知识，一行三列，就是均分布局，均分我们一般选择使用flex布局。
      所以提供一个flex容器，确定子组件的宽度，并将内容平铺上去。
      
    \`\`\`json type="actions" file="一行三列导航生成步骤.json"
    ["_root_",":root","doConfig",{"path":"root/标题","value":"一行三列的导航"}]
    ["_root_",":root","doConfig",{"path":"root/布局","value":{"display":"flex","flexDirection":"column","alignItems":"center"}}]
    ["_root_","_rootSlot_","addChild",{"title":"Flex容器","ns":"some.container","comId":"u_iiusd7","layout":{"width":"100%","height":200,"marginLeft":8,"marginRight":8},"configs":[{"path":"常规/布局","value":{"display":"flex","flexDirection":"row","justifyContent":"space-between","alignItems":"center","flexWrap":"wrap"}}]}]
    ["u_iiusd7","content","addChild",{"title":"导航1","ns":"some.icon","comId":"u_icon1","layout":{"width":120,"height":120,"marginTop":8},"configs":[{"path":"样式/文本","style":{"background":"#0000FF"}}]}]
    \`\`\`

    注意：
      - 这个Flex容器是根组件的直接子组件，所以不允许添加ignore标记。
    </assistant_response>
  </example>`,
    contextDoc: `<对于当前搭建有以下特殊上下文>
  <搭建画布信息>
    当前搭建画布的宽度为1024，所有元素的尺寸需要关注此信息，且尽可能自适应布局。1024只是在MyBricks搭建时的画布宽度，实际运行时可能会更宽。
    
    搭建内容必须参考PC端网站进行设计，内容必须考虑左右排列的丰富度，以及以下PC的特性
      比如:
        1. 布局需要自适应画布宽度，实际运行的电脑宽度不固定；
        2. 宽度和间距配置的时候要注意，画布只有1024，特别注意总宽度不可以超过1024；
        3. 页面可以配置backgroundColor；
    搭建风格也要尽可能贴合中国网站的设计风格；
  </搭建画布信息>

  <允许使用的图标>
  antd中的图标
  </允许使用的图标>

  <返回的文件格式>
  必须为\`\`\`json file="actions.json" \`\`\`格式的操作列表，其中 file="actions.json" 不可省略，否则无法区分。
  </返回的文件格式>
</对于当前搭建有以下特殊上下文>`
  },
  prd: {
    examples: ``,
    queryFocusCanvasWidth: () => '1024'
  }
}

export const MockMobile = {

}