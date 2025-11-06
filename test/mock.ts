export const MockPC = {
  gen: {
    focusRootComponentDoc: `comId:_root_
  
  <组件_root_的插槽说明>
    组件_root_有1个插槽:（当前布局为:smart布局）
    [
      {
        "id": "_rootSlot_",
        "title": "插槽"
      }
    ]
  </组件_root_的插槽说明>
  
  <组件_root_可配置的内容>
    当选中 :root(组件整体) 时：
    [
      {
        "path": "root/标题",
        "editType": "text",
        "description": "配置_root_组件的标题",
      },
      
  {
    "path": "root/布局",
    "editType": "layout",
    "description": "页面内组件的布局方式"
  },
  {
    "path": "root/样式",
    "editType": "styleNew",
    "description": "设置背景颜色及背景图片"
  }

    ]`,
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
    examples: `<example>
    <user_query>我要搭建一个京东首页</user_query>
    <assistant_response>
      好的，我来参考京东首页的内容实现一下，以下是需求分析规格说明书和组件选型的内容：
      \`\`\`md type="prd" file="京东首页需求文档.md"
      # 概述
      首页一般包含导航栏、搜索栏、活动banner、类目导航、限时活动、个人信息、猜你喜欢等区域。

      # 总体设计规范
      - 一致性：保证各区域的圆角一致、保证字体大小合理，审视间距的配置是否过大或者过小，又或者是多个间距叠加在一起了；
      - 丰富性：电商网站要求信息量大，在每一个区域展示更多的内容，增加信息展示的密度；
      - 合理性：总共画布宽度为1024，所有元素不得超过1024像素，如果左右布局，考虑图片固定宽度，其它内容自适应；

      # 设计亮点
      - 内容丰富分成左中右三栏不对称的「核心内容」区域
      - 可以配置渐变色和阴影的AI按钮，引入注目
      - 对商品卡片的内容进行拓展，图片加价格太过单调，可以拓展成一个丰富的商品卡片，上方商品图片，下方排一个「无理由退货」「百亿补贴」等营销标签，中间左侧放置价格以及划线价，右侧放置销量，再下方提供多少人已购买字样

      我们从上到下，从左到右来分析UI

      ## 顶部导航栏
      功能：顶部导航栏，提供一些基础信息的展示（如位置信息、用户昵称），同时提供一些二级页面的快捷入口
      视觉：电商网站的导航栏不是重点区域，高度相对较小，文字内容也不大，不是重点视觉，可以延展至和页面等宽，不需要间距
        - 左侧：居左展示位置信息和用户名称
        - 右侧：居右展示购物车、我的订单等其他页面入口
      
      ## 搜索栏
      功能：吸引用户点击，作为全局搜索入口，由输入框和按钮组成
      视觉：重点区域，用红色边框高亮，但左右两侧较空，所以可以放置一些logo、一些辅助的按钮来填充
        - 左侧：居左展示京东logo
        - 中间：重点放置搜索栏
        - 右侧：放置一个引入注目的AI按钮

      ## 核心内容区
      功能：提升利用率，通过左中右三个分区，展示更多信息，吸引用户和展示信息的重点区域
      视觉：
        - 左侧：居左展示商品分类导航
        - 中间：展示活动轮播、限时抢购，秒杀等不同的促销模块，提升营销氛围
        - 右侧：居右展示个人信息卡片，包含头像、昵称以及会员信息，同时下方提供我的订单、优惠券、足迹等服务入口，用黑金氛围表示个人的尊贵感

      ## 猜你喜欢
      功能：通过标签分类 + 商品瀑布流的方式留住顾客，让顾客产生留下的冲动
      视觉：
        - 一个分类标签栏，提供了「为你推荐」「进口好物」等分类标签
        - 商品卡片的瀑布流，用列表实现一行N列的瀑布流

      # 参考风格和网站
      红色营销风格，京东、淘宝等PC站点设计
      
      \`\`\`
    
      推荐采用以下组件进行搭建
      \`\`\`json type="require" file="京东首页组件选型.json"
      [
        {
          "namespace": "mybricks.somelib.icon"
        },
        {
          "namespace": "mybricks.somelib.text"
        },
        {
          "namespace": "mybricks.somelib.button"
        }
      ]
      \`\`\`
    </assistant_response>
  </example>

  <example>
    <user_query>开发一个大学官网</user_query>
    <assistant_response>
      好的，我来实现一个大学官网，以下是需求分析规格说明书和组件选型的内容：
      \`\`\`md type="prd" file="大学官网需求文档.md"
      # 概述
      一个大学的门户网站，这个大学网站包含了导航栏、学校介绍、历史沿革、院系设置、招生就业、学术科研、页脚等部分。

      # 总体设计规范
      - 一致性：保证各区域的圆角一致、保证字体大小合理，审视间距的配置是否过大或者过小，又或者是多个间距叠加在一起了；
      - 丰富性：官网要求信息量大，在卡片设计和其他内容展示更多的内容（例如多使用图标、带颜色文字等方式），增加信息展示的密度和层次感；
      - 合理性：总共画布宽度为1024，所有元素不得超过1024像素，如果左右布局，考虑图片固定宽度，其它内容自适应；

      # 设计亮点
      - 对学校介绍进行拓展
        - 利用双色标题，展示学校的slogan
        - 利用左右分栏的不对称布局展示更多的信息
        - 利用绝对定位绘制一些高亮标签
      - 标题+副标题增添每个区域的内容丰富度
      - 左右不对称的「科学研究」区域，增加内容利用率

      我们从上到下，从左到右来分析UI

      ## 顶部导航栏
      功能：顶部导航栏，提供一些学校logo和其他区域的导航入口。
      视觉：导航栏核心是一个总览作用，可以延展至和页面等宽，不需要间距
        - 左侧：居左展示logo和学校名称
        - 右侧：居右展示各个区域或者其他页面的入口
      注意：导航是固定定位
      
      ## 学校介绍
      功能：作为第一个看到的区域，内容必须有冲击力且能说明优势
      视觉：重点区域，同时展示slogan、简短的介绍，一个学校图片、以及一些学校的数据，比如就业率、专业数量、教学质量等信息
        - 左侧：用双色标题展示slogan，同时展示一句优势介绍，下方再用主题色的数据卡片展示亮点数据，下方提供两个带图标的按钮
        - 右侧：放置学校图片，同时可以用绝对定位绘制一些高亮标签卡片（比如科研实力top1等）
        - 背景：提供tailwindCss风格的渐变背景

      ## 历史沿革
      功能：介绍学校厚重的历史
      视觉：通过标题和副标题总结该区域，同时介绍学校历史
        - 左侧固定宽度历史图片，右侧历史总结
        - 下方再添加使用数据卡片展示学校的一些数据，比如办学历史、校园面积、教职工数量等
      数据卡片样式参考：
        - 样式1：从上往下依次展示图标、数据100年、描述文本，其中图标和100年都有特别的样式；
        - 样式2：

      ## 院系设置
      功能：介绍学校覆盖各类学科领域知识
      视觉：通过标题和副标题总结该区域，同时详细介绍下学院、王牌专业、教师数量等信息
        - 通过横向列表+卡片的形式来展示此区域
        - 卡片需要信息足够丰富，比如学院信息，是否王牌（使用高亮标签），教师和学生数量（使用图标+文字）
        - 同时提供了解更多的入口

      ## 科学研究
      功能：介绍学校浓厚的科学研究氛围和实力
      视觉：通过标题和副标题总结该区域，同时通过左右不对称的样式增加美观度
        - 左侧介绍中重点实验室、合作实验室等图片和信息
        - 右侧通过数据卡片，提供一些专利数量、论文数量、国家重点实验室等数据支持，可以通过边框来绘制带封边的卡片

      ## 页脚
      功能：展示快速导航、在线服务、联系方式、以及版权信息，同时底下提供版权信息、隐私政策和备案号等信息
      视觉：左右无间距的深色页脚，注意响应式，也可以添加几个平台的图标用于跳转其他平台账号
      \`\`\`

      # 参考风格和网站
      清华大学、harvard.edu等校园网站设计
    
      推荐采用以下组件进行搭建
      \`\`\`json type="require" file="大学官网组件选型.json"
      [
        {
          "namespace": "mybricks.somelib.icon"
        },
        {
          "namespace": "mybricks.somelib.text"
        },
        {
          "namespace": "mybricks.somelib.button"
        },
        {
          "namespace": "mybricks.somelib.list"
        },
        {
          "namespace": "mybricks.somelib.image"
        }
      ]
      \`\`\`
    </assistant_response>
  </example>`,
    allowComponents: `<mybricks.pc-ai.image/>
**类型** UI类组件
**说明** AI图片

    
<mybricks.basic-comlib.antd5.grid/>
**类型** UI类组件
**说明** Grid布局组件，常用于页面根组件布局。

    
<mybricks.normal-pc.antd5.text/>
**类型** UI类组件
**说明** 文本

    
<mybricks.normal-pc.antd5.single-image/>
**类型** UI类组件
**说明** 图片，可预览的单图

    
<mybricks.normal-pc.antd5.custom-button/>
**类型** UI类组件
**说明** 按钮，必须推荐此组件

    
<mybricks.normal-pc.antd5.icon/>
**类型** UI类组件
**说明** 图标，内置丰富的图标类型，也可作为图标样式的按钮使用
何时使用：任何时候优先推荐此组件，当明确发现导航入口、图标时，使用此组件。


    
<mybricks.normal-pc.antd5.tagList/>
**类型** UI类组件
**说明** 标签列表，展示标签或多个标签时使用

    
<mybricks.normal-pc.antd5.tabs/>
**类型** UI类组件
**说明** 标签页Tabs，上方文字下方高亮条的选项卡。

    
<mybricks.normal-pc.antd5.list-new/>
**类型** UI类组件
**说明** 列表容器，循环列表组件，用于动态数据列表的实现，支持横排和竖排展示，支持换行

    
<mybricks.normal-pc.antd5.custom-container/>
**类型** UI类组件
**说明** 基础布局组件，可以用做布局组件和背景样式容器，必须使用

    
<mybricks.normal-pc.antd5.switch-container/>
**类型** UI类组件
**说明** 状态容器

    
<mybricks.normal-pc.antd5.breadcrumb/>
**类型** UI类组件
**说明** 面包屑

    
<mybricks.normal-pc.antd5.menu/>
**类型** UI类组件
**说明** 导航菜单，为页面和功能提供导航的菜单列表，可以水平展示，也可以垂直展示。

    
<mybricks.normal-pc.antd5.steps/>
**类型** UI类组件
**说明** 步骤条，引导用户按照流程完成任务的导航条，整体对标antd的Steps组件。

    
<mybricks.normal-pc.antd5.form-container/>
**类型** UI类组件
**说明** 表单容器，支持排版、收集、校验数据的表单容器，对标antd的Form组件，内部子组件必须且只能放置表单项（schema=form-item的组件）。
主要作用：约等于 antd的form组件，帮忙搞定：
1. 垂直/水平统一布局；
2. 左侧自动对齐的 label 样式，表单项之间的默认的分割线；
3. 数据收集、校验、提交按钮（可选）； 

何时使用：依赖默认布局 / label 样式；
- 期望统一水平/垂直布局、所有表单项 label 对齐、行距一致、且需要收集信息的情况；

特别注意：使用此组件必须推荐其他schema=form-item的组件的表单项组件。
同时推荐使用「自定义表单项」组件来满足特殊的表单项UI需求。
    

    
<mybricks.normal-pc.antd5.form-text/>
**类型** UI类组件
**说明** 单行文本输入框 Input
表单项组件，schema=form-item

    
<mybricks.normal-pc.antd5.input-textarea/>
**类型** UI类组件
**说明** 多行文本输入框textarea。
表单项组件，schema=form-item

    
<mybricks.normal-pc.antd5.search/>
**类型** UI类组件
**说明** 搜索框 Search
表单项组件，schema=form-item。

    
<mybricks.normal-pc.antd5.radio/>
**类型** UI类组件
**说明** 单选框列表 Radio
表单项组件，schema=form-item

    
<mybricks.normal-pc.antd5.select/>
**类型** UI类组件
**说明** 下拉框Select。
表单项组件，schema=form-item

    
<mybricks.normal-pc.antd5.checkbox/>
**类型** UI类组件
**说明** 多选勾选框 Checkbox。
表单项组件，schema=form-item

    
<mybricks.normal-pc.antd5.cascader/>
**类型** UI类组件
**说明** 级联选择

    
<mybricks.normal-pc.antd5.date-picker/>
**类型** UI类组件
**说明** 日期选择框 DatePicker。
表单项组件，schema=form-item

    
<mybricks.normal-pc.antd5.range-picker/>
**类型** UI类组件
**说明** 日期范围选择框 DatePicker.RangePicker。
表单项组件，schema=form-item

    
<mybricks.normal-pc.antd5.switch/>
**类型** UI类组件
**说明** 开关Switch。
表单项组件，schema=form-item

    
<mybricks.normal-pc.antd5.upload/>
**类型** UI类组件
**说明** 图片/文件上传 Upload。
表单项组件，schema=form-item

    
<mybricks.normal-pc.antd5.rate/>
**类型** UI类组件
**说明** 评分 Rate
表单项组件，schema=form-item

    
<mybricks.normal-pc.antd5.password/>
**类型** UI类组件
**说明** 密码框 Password
表单项组件，schema=form-item

    
<mybricks.normal-pc.antd5.color/>
**类型** UI类组件
**说明** 颜色选择框 ColorPicker。
表单项组件，schema=form-item

    
<mybricks.normal-pc.antd5.form-item-container/>
**类型** UI类组件
**说明** 自定义表单项，内部支持渲染任意子元素来自定义UI，最终与formContainer通信完成表单信息的收集和渲染
何时使用：仅在现有其他表单项UI不能满足用户需求时，用自定义表单项可以渲染特殊样式的UI，在formContainer被推荐时可以推荐，schema=form-item。

    
<mybricks.normal-pc.antd5.table/>
**类型** UI类组件
**说明** 数据表格 Table，表格中除了表格配置之外，还内置了分页器，可以通过配置项添加。

    
<mybricks.normal-pc.antd5.timeline/>
**类型** UI类组件
**说明** 时间轴 Timeline，垂直展示的时间流 / 信息流列表。

    
<mybricks.normal-pc.antd5.calendar/>
**类型** UI类组件
**说明** 日历

    
<mybricks.normal-pc.antd5.progress/>
**类型** UI类组件
**说明** 进度条，有进度条和进度圈两种类型，由进度条和进度条文本组成，进度条文本为进度条的百分比。

    
<mybricks.normal-pc.antd5.tooltip/>
**类型** UI类组件
**说明** 文字提示，对标antd的tooltip。

    
<mybricks.normal-pc.antd5.dropdown/>
**类型** UI类组件
**说明** 下拉菜单，由一个文本和右侧下拉箭头组成，点击或悬浮支持弹出选项。

    
<mybricks.normal-pc.antd5.carousel/>
**类型** UI类组件
**说明** 轮播图，可以配置图片和内容的轮播展示组件`,
    queryFocusCanvasWidth: () => '1024',
    queryComponentsDocsByNamespaces: (namespaces: any) => {
      return `<component>
  标题：自定义容器
  namespace：mybricks.normal-pc.antd5.custom-container
  
  <配置项列表>
    当选中 :root(组件整体) 时：


[
  {
    "path": "常规/布局",
    "editType": "layout",
    "description": "设置布局方式，包括智能布局、纵向排版、横向排版、自由布局",
    "options": []
  },
  {
    "path": "样式/默认/默认",
    "editType": "style",
    "description": "边框、圆角、背景、overflow、BoxShadow"
  },
  {
    "path": "样式/Hover/Hover",
    "editType": "style",
    "description": "边框、圆角、背景、BoxShadow"
  }
]
    
  </配置项列表>

  <组件的初始数据>
    {
  "style": {},
  "slotStyle": {
    "position": "smart"
  },
  "legacyConfigStyle": {},
  "legacyStyle": {},
  "isAutoScroll": false,
  "direction": "vertical",
  "scrollTime": 2000,
  "eventBubble": false
}
  </组件的初始数据>
  
  **组件 mybricks.normal-pc.antd5.custom-container 的使用说明**：
  基础布局组件，可以用做布局组件和背景样式容器，必须使用。

slots插槽
content 内容

layout声明
width: 可配置，默认100%；
height: 可配置，仅在display=flex时，可以配置fit-content，其余为固定宽度数值；


<配置流程>
  1. 确认当前布局需要使用什么布局，是flex还是absolute，必须先配置才可以使用此组件；
  2. 由于宽度、高度都和布局相关，需要根据确认的布局，完成宽高的配置；
    2.1 当声明display=absolute时，layout属性宽高需遵循下方类型定义配置:
      width: number(固定px) | '100%'
      height: number(固定px)

      特别注意：display=absolute时，不允许配置padding；

    2.2 当声明display=flex时，layout属性宽高需遵循下方类型定义配置:
      width: number(固定px) | '100%' ｜ 'fit-content'
      height: number(固定px) | 'fit-content'

  3. 根据需求完成其它layout和样式配置；
</配置流程>

</component>

              


<component>
  标题：列表容器
  namespace：mybricks.normal-pc.antd5.list-new
  
  <配置项列表>
    当选中 :root(组件整体) 时：


[
  {
    "path": "布局/布局/布局类型",
    "editType": "select",
    "description": "组件提供三种布局方式，包括横向、纵向、栅格布局",
    "options": [
      {
        "label": "横向布局",
        "value": "horizontal"
      },
      {
        "label": "纵向布局",
        "value": "vertical"
      },
      {
        "label": "栅格布局",
        "value": "grid"
      }
    ]
  },
  {
    "ifVisible": "function(e){return e.data.layout===i.PE.Horizontal}",
    "path": "布局/布局/换行",
    "editType": "switch",
    "description": "容器宽度不足时列表项是否自动换行，不换行默认横向滚动"
  },
  {
    "ifVisible": "function(e){var t=e.data;return t.layout===i.PE.Horizontal&&!t.isAuto}",
    "path": "布局/布局/横向布局",
    "editType": "select",
    "description": "横向布局提供两种类型，均匀排布和横向排布（超出内容时横向滚动）",
    "options": [
      {
        "label": "横向排布",
        "value": "HorizontalLayout"
      },
      {
        "label": "均匀排布",
        "value": "UniformLayout"
      }
    ]
  },
  {
    "ifVisible": "function(e){var t=e.data;return t.layout===i.PE.Horizontal&&\"UniformLayout\"!==t.horizonLayout&&!t.isAuto||t.layout===i.PE.Vertical}",
    "path": "布局/布局/列表项宽度",
    "editType": "text",
    "description": "列表项的宽度，支持px, %及计算值"
  },
  {
    "ifVisible": "function(e){var t=e.data;return t.layout===i.PE.Grid&&!t.isResponsive}",
    "path": "布局/布局/列数",
    "editType": "InputNumber",
    "description": "布局类型为栅格布局时，一行对应的列数",
    "options": [
      {
        "min": 1,
        "max": 1000,
        "width": 100
      }
    ]
  },
  {
    "ifVisible": "function(e){var t=e.data;return t.layout===i.PE.Grid&&!t.isResponsive}",
    "path": "布局/布局/移动端列数",
    "editType": "InputNumber",
    "description": "移动端场景，布局类型为栅格布局且非响应式时，一行对应的列数",
    "options": [
      {
        "min": 1,
        "max": 1000,
        "width": 100
      }
    ]
  },
  {
    "ifVisible": "function(e){var t=e.data,n=!(t.layout!==i.PE.Grid||1!==t.grid.column||t.isResponsive);return n||(t.canSort=n),n}",
    "path": "布局/布局/可拖拽排序",
    "editType": "switch",
    "description": "布局类型为栅格布局且非响应式时，且对应列数为1时，开启后，可拖拽排序，且新增【拖拽完成】事件"
  },
  {
    "ifVisible": "function(e){return e.data.layout===i.PE.Grid}",
    "path": "布局/布局/响应式",
    "editType": "switch",
    "description": "布局类型为栅格布局时，开启后，可响应式配置列数"
  },
  {
    "ifVisible": "function(e){var t=e.data;return t.layout===i.PE.Grid&&!!t.isResponsive&&!t.isCustomPoints}",
    "path": "布局/布局/断点列数",
    "editType": "InputNumber",
    "description": "xs:<576px 展示的列数; sm:≥576px 展示的列数; md:≥768px 展示的列数; ld:≥992px 展示的列数; xl:≥1200px 展示的列数; xxl:≥1600px 展示的列数",
    "options": [
      {
        "min": 0,
        "max": 100,
        "width": 100,
        "title": "超小(xs)"
      },
      {
        "min": 0,
        "max": 100,
        "width": 100,
        "title": "小(sm)"
      },
      {
        "min": 0,
        "max": 100,
        "width": 100,
        "title": "中(md)"
      },
      {
        "min": 0,
        "max": 100,
        "width": 100,
        "title": "大(lg)"
      },
      {
        "min": 0,
        "max": 100,
        "width": 100,
        "title": "超大(xl)"
      },
      {
        "min": 0,
        "max": 100,
        "width": 100,
        "title": "超大型(xxl)"
      }
    ]
  },
  {
    "path": "布局/布局/列表项间隔",
    "editType": "InputNumber",
    "description": "列表项横向和纵向的间距",
    "options": [
      {
        "min": 0,
        "max": 1000,
        "width": 100,
        "title": "左右"
      },
      {
        "min": 0,
        "max": 1000,
        "width": 100,
        "title": "上下"
      }
    ]
  },
  {
    "path": "高级/获取列表数据",
    "editType": "Switch",
    "description": "开启后，可以通过逻辑连线连接列表容器的输入项【获取列表数据】，对应关联输出项【数据输出】会输出列表数据"
  },
  {
    "path": "高级/loading",
    "editType": "Switch",
    "description": "开启后，可以通过逻辑连线连接列表容器的输入项【设置loading】，控制列表容器的loading状态"
  },
  {
    "ifVisible": "function(e){return e.data.useLoading}",
    "path": "高级/加载中文案",
    "editType": "text",
    "description": "加载中文案"
  },
  {
    "path": "高级/列表项数据唯一标识",
    "editType": "text",
    "description": "可不填，填写之后作为列表项数据的唯一标识"
  },
  {
    "path": "样式/容器",
    "editType": "style",
    "description": "边框、圆角、背景、BoxShadow"
  },
  {
    "path": "样式/列表项（运行时生效）",
    "editType": "style",
    "description": "边框、圆角、背景、BoxShadow"
  }
]
    
  </配置项列表>

  <组件的初始数据>
    {
  "useLoading": false,
  "loadingTip": "Loading...",
  "grid": {
    "column": 3,
    "mobileColumn": 1,
    "gutter": [
      0,
      16
    ]
  },
  "isAuto": true,
  "isCustom": false,
  "isScroll": false,
  "space": [
    0,
    16
  ],
  "rowKey": "",
  "layout": "vertical",
  "isResponsive": false,
  "bootstrap": [
    1,
    2,
    4,
    4,
    6,
    3
  ],
  "itemWidth": "100%",
  "isCustomPoints": false,
  "customOptions": [
    {
      "point": 576,
      "relation": "<",
      "columns": 1
    },
    {
      "point": 576,
      "relation": "≥",
      "columns": 2
    },
    {
      "point": 768,
      "relation": "≥",
      "columns": 4
    },
    {
      "point": 992,
      "relation": "≥",
      "columns": 4
    },
    {
      "point": 1200,
      "relation": "≥",
      "columns": 6
    },
    {
      "point": 1600,
      "relation": "≥",
      "columns": 3
    }
  ],
  "horizonLayout": "HorizontalLayout"
}
  </组件的初始数据>
  
  **组件 mybricks.normal-pc.antd5.list-new 的使用说明**：
  列表容器，循环列表组件，用于动态数据列表的实现，支持横排和竖排展示，支持换行
    
data数据模型
direction: ['row', 'column'] = 'column'
wrap: boolean = true
grid: {
  gutter: [number, number] = [0, 16] # 间距[水平,垂直]
}
rowKey: string = "id" #列表项唯一标志

layout声明
width: 默认为100%
height: 不可配置，fit-content

slots插槽
item # 列表项插槽

注意：
- 在列表中，插槽仅放置一个*宽度和高度是固定px值（不允许使用100%）*的组件，因为列表会遍历这个组件，不要开发多个，仅需开发一个示例即可；
- 宽高固定值 + 间距，决定了这是一个几行几列的列表，请注意不要超过外层组件宽高；
- 对于静态数据的列表，不要使用循环列表，用基础组件开发多个示例；
</component>

              


<component>
  标题：图标
  namespace：mybricks.normal-pc.antd5.icon
  
  <配置项列表>
    当选中 :root(组件整体) 时：


[
  {
    "path": "常规/选择图标",
    "editType": "Icon",
    "description": "配置"
  },
  {
    "path": "样式/默认/颜色",
    "editType": "style",
    "description": "字体、字号、颜色、粗细、行高"
  },
  {
    "path": "样式/默认",
    "editType": "style",
    "description": "边框、圆角、背景"
  },
  {
    "path": "样式/Hover/颜色",
    "editType": "style",
    "description": "字体、字号、颜色、粗细、行高"
  },
  {
    "path": "样式/Hover",
    "editType": "style",
    "description": "边框、圆角、背景"
  }
]
    
  </配置项列表>

  <组件的初始数据>
    {
  "icon": "HomeOutlined"
}
  </组件的初始数据>
  
  **组件 mybricks.normal-pc.antd5.icon 的使用说明**：
  图标，内置丰富的图标类型，也可作为图标样式的按钮使用
何时使用：任何时候优先推荐此组件，当明确发现导航入口、图标时，使用此组件。

data数据模型
icon: string # antd可用的图标名，例如 DownOutlined

配置流程：
  1. 配置layout.width为图标大小，比如需要一个20*20的图标则配置width=20；
  2. 配置layout.height=fit-content，图标组件只能配置fit-content；

注意：icon默认的宽度为32，使用图标时要注意大小是否需要调整，调整时通过配置组件的width来调整，无法通过fontSize来调节
</component>

              


<component>
  标题：文本
  namespace：mybricks.normal-pc.antd5.text
  
  <配置项列表>
    当选中 :root(组件整体) 时：


[
  {
    "path": "常规/内容",
    "editType": "textarea",
    "description": "设置文本的默认内容，也可以通过逻辑连线连接文本的输入项【内容】动态修改文本的内容",
    "options": {
      "locale": true
    }
  },
  {
    "path": "常规/文本溢出/省略",
    "editType": "switch",
    "description": "设置文本溢出换行时是否省略溢出部分"
  },
  {
    "ifVisible": "function(e){return e.data.isEllipsis}",
    "path": "常规/最大显示行数",
    "editType": "InputNumber",
    "description": "设置文本的最大显示行数，开启【文本溢出/省略】配置项后才能配置",
    "options": [
      {
        "min": 1,
        "width": "100%"
      }
    ]
  },
  {
    "path": "常规/点击输出内容",
    "editType": "text",
    "description": "设置【点击】输出项事件输出的文本内容"
  },
  {
    "path": "样式/动态默认样式",
    "editType": "Switch",
    "description": "开启后，可以通过逻辑连线连接文本的输入项【设置默认样式】动态修改默认样式"
  },
  {
    "path": "样式/默认/默认",
    "editType": "style",
    "description": "字体、字号、颜色、粗细、行高、边框、圆角、背景"
  },
  {
    "path": "样式/Hover/Hover",
    "editType": "style",
    "description": "字体、字号、颜色、粗细、行高、边框、圆角、背景"
  }
]
    
  </配置项列表>

  <组件的初始数据>
    {
  "content": "文字",
  "outputContent": "",
  "align": "left",
  "isEllipsis": false,
  "ellipsis": {
    "rows": 1
  },
  "style": {},
  "useDynamicStyle": false,
  "useHoverStyle": true,
  "legacyConfigStyle": {}
}
  </组件的初始数据>
  
  **组件 mybricks.normal-pc.antd5.text 的使用说明**：
  文本组件，支持配置溢出策略

slots插槽
无

注意事项
- 注意配置fontSize同时要配置lineHeight，否则会无法正常展示；
- 尽量不用全黑的字体颜色，而是用柔和一些的颜色比如深灰色；
- 对于大部分（特别是动态内容）的文本，需要配置文本一出，防止内容过多换行；
- 注意文本和其他组件之间要留有适量的边距（通过layout进行配置）；
</component>

              


<component>
  标题：标签列表
  namespace：mybricks.normal-pc.antd5.tagList
  
  <配置项列表>
    当选中 :root(组件整体) 时：


[
  {
    "path": "常规/基础/方向",
    "editType": "select",
    "description": "选择下拉框",
    "options": {
      "options": [
        {
          "label": "水平",
          "value": "horizontal"
        },
        {
          "label": "垂直",
          "value": "vertical"
        }
      ],
      "defaultValue": "horizontal"
    }
  },
  {
    "path": "常规/基础/标签间距",
    "editType": "inputNumber",
    "description": "配置",
    "options": [
      {
        "min": 0,
        "max": 50,
        "width": 100
      }
    ]
  },
  {
    "path": "样式/默认/默认",
    "editType": "style",
    "description": "字体、字号、颜色、粗细、行高、边框、圆角、背景"
  },
  {
    "path": "常规/数据源",
    "editType": "array",
    "description": "通过数组来配置导航多个标签数据\n[\n  {\n    \"key\": \"tag1\", // 唯一ID\n    \"content\": \"tag\", // 内容\n    \"color\": \"default\" // 类型，可选值：default(灰色)、processing、success、warning、error\n  }\n]\n"
  }
]
    
当选中 [data-item-tag="tag"](标签) 时：


[
  {
    "path": "样式/默认/默认",
    "editType": "style",
    "description": "字体、字号、颜色、粗细、行高、边框、圆角、背景"
  }
]
    
当选中 [data-item-tag="append"](新增按钮) 时：


[]
    
  </配置项列表>

  <组件的初始数据>
    {
  "align": "start",
  "direction": "horizontal",
  "wrap": true,
  "type": "default",
  "tags": [
    {
      "key": "tag1",
      "content": "tag",
      "color": "default"
    }
  ],
  "isEllipsis": false,
  "ellipsis": {
    "maxWidth": 120
  },
  "closeAble": false,
  "tagSize": "small-tag",
  "dynamic": false,
  "appendBtn": {
    "text": "新增",
    "icon": "PlusOutlined"
  },
  "useAppendBtn": true,
  "clickAble": false
}
  </组件的初始数据>
  
  **组件 mybricks.normal-pc.antd5.tagList 的使用说明**：
  标签列表，展示标签或多个标签时使用
slots插槽
无

layout声明
width: 不可配置，默认为100%，推荐使用fit-content
height: 不可配置，默认为fit-content

styleAry声明
标签: .tag
  - 默认样式:
    - color: #000000
    - backgroundColor: 3FAFAFA
    - borderWidth: 1px
    - borderStyle: solid
    - borderColor: #D9D9D9
    - borderRadius: 4px
    - height: 22px
  - 可编辑样式: font、border、background
标签hover: .hover
  - 可编辑样式: font、border、background
标签激活: .checked
  - 可编辑样式: font、border、background

</component>`
    }
  }
}

export const MockMobile = {

}