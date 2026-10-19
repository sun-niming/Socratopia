<!-- startPage: 7 endPage: 9 chunkId: md-0007 ordinal: 7 loadedOnly: true -->
--- 第 7 页 ---
②有重要性声明（ 在每条声明的值后，分号前 加上 !important ）的直接应用该声明。当两
条相互冲突带有!import规则的声明应用到相同元素时，拥有更大优先级的声明将会被采用。

③层次、具体程度都相同时，后来者居上(后出现的优先)。

https://developer.mozilla.org/zh-CN/docs/Web/CSS/Specificity

1.7 CSS的层叠性
选择器的特殊性（优先级）计算规则：

选择器的优先级可以由三个不同的值（或分量）表示，即“ID , 类 , 元素”。按从左到右次序比较，直到
能比较出结果则停止。
ID：选择器中包含 ID 选择器的数量。
类：选择器中包含类选择器、属性选择器或者伪类数量。
元素：选择器中包含元素、伪元素选择器的数量。

1.7 CSS的层叠性
选择器的特殊性（优先级）计算规则：

选择器的优先级可以由三个不同的值（或分量）表示，即“ID , 类 , 元素”。按从左到右次序比较，直到
能比较出结果则停止。
ID：选择器中包含 ID 选择器的数量。
类：选择器中包含类选择器、属性选择器或者伪类数量。
元素：选择器中包含元素、伪元素选择器的数量。

1.8 CSS的继承性

- CSS的继承性是指如果子元素定义的样式没有和父元素定义的样式发生冲突，那么
子元素将继承父元素的样式风格。

- 合理利用CSS的继承性，可以大大缩减代码量，并提高可读性。

- 需要注意：并不是所有的CSS属性都具有继承性，具体可参考CSS相关文档。

>> 本部分主要内容

1. CSS语法

2. CSS常用样式

3. 定位与布局

4. 弹性盒子与网格布局

5. CSS3

6. 响应式布局

2.1单位与颜色

（1）绝对单位
绝对单位是固定的，不会因为其他元素的尺寸变化而改变

物理单位：英寸(in)、厘米(cm)、毫米(mm)、磅(pt)和皮卡(pc) 。

像素单位：像素(px)

2.1单位与颜色

（2）相对单位
相对单位是相对于其他长度或元素的属性来计算的。
经常使用的相对单位包括：em、rem、ex、%、vh、vw。

（相对父元素尺寸）

rem      相对根元素字体尺寸

2.1单位与颜色

（3）颜色的值
CSS中定义颜色值可以使用命名颜色、rgb颜色和十六进制颜色等表示方法。

- 命名颜色
- 颜色的英文名称，如：red、blue等

- rgb和rgba颜色函数
- 按三原色原理合成颜色，如：rgb(255,128,0) 和 rgba(255,0,0,.8)

- 十六进制颜色描述
- 按三原色原理合成颜色，如：#fe8700
- 对于 #aabbcc 的形式可以简写为 #abc

2.1单位与颜色

2.2 CSS变量

自定义属性（有时候也被称作CSS 变量或者级联变量）是由 CSS 作者定义的，它包含的值可以在

整个文档中重复使用。由自定义属性标记设定值，由 var() 函数来获取值。

2.3 文本与字体样式
常见的文本属性及其取值如下表所示。

2.3 文本与字体样式
CSS字体属性定义字体名、大小、加粗及斜体等，字体属性如下表所示：

2.3 文本与字体样式

（1）font-family属性需要注意。

① 设置一系列字体，客户端第一项未安装导致无法显示,则显示第二项字体，依此类推。

② 中文字体名称有中英文两种，考虑到兼容性，可将字体中英文名称都列出来。
如：font-family: "Microsoft YaHei", "微软雅黑";

③ 当字体名包含空格和其他字符，需要在字体外加引号，单引号或双引号都可以。

（2）font属性：

属性值有先后顺序，字号与行高可用/分隔。
必须包含以下值：<font-size> 和 <font-family>

2.4 超链接样式

超链接有四种不同状态，在设置样式时用到伪类选择器，如下表所示：

其中，设置超链接样式需要遵守一定顺序，被称为love&hate原则，即。
a:link →a:visited→a:hover→a:active

2.5 背景样式

2.6 列表样式

2.7 表格样式

>> 本部分主要内容

1. CSS语法

2. CSS常用样式

3. 定位与布局

4. 弹性盒子与网格布局

5. CSS3

6. 响应式布局

3.1 盒子模型

- 盒子模型（Box Model） 是网页布局的基础概念，它决定了如何
计算元素的总宽度和高度。

- 每个HTML元素在页面中都可以被视为一个矩形的盒子。

- 网页就是由许多个盒子通过不同的排列方式（上下、左右、嵌套）
组合而成。

3.1 盒子模型（构成）

content：主体内容,width、height                                                                                                                                           margin-top

border-topmargin：边界，四个方向为margin-top，
margin-right，margin-bottom，margin-left                                       padding-top

--- 第 8 页 ---
content                                                                                                                                                                                                                                                                                                                                                                            heightborder：边框，四个方向为border-top，                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               margin-left              border-left             padding-left                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       border-right                margin-right                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           padding-right
border-right，border-bottom，border-left                                       padding-bottom
padding：填充，四个方向为padding-top，                                         border-bottom
padding-right，padding-bottom，padding-left                            margin-bottom

width

3.1盒子模型（两种盒子模型）

- 理解盒子模型最关键的一点：元素的总宽度和总高度是如何计算的？
- box-sizing 这个 CSS 属性：

--- 第 9 页 ---
3.1盒子模型（两种盒子模型）

content-box (标准盒子模型)

- CSS 的默认设置，此时，width 和
height 只应用于内容区 (Content)。

- 元素的总宽度 = width + padding-
left + padding-right + border-left
+ border-right               这个 .box 元素在页面上占据的实际宽度是：
- 元素的总高度 = height + padding-        200px (width) + 10px (padding               - left)
top + padding-bottom + border-        + 10px (padding       - right) + 2px

(border   - left) + 2px (border            - right) =  top + border-bottom

224px 。

3.1盒子模型（两种盒子模型）

border-box (替代盒子模型)

- 为解决 content-box 的计算不直观的
问题，CSS3 引入了 border-box。在
此模型下， 设置的width 和 height值
包含了内容区、内边距和边框。

- 元素的总宽度 = 设置的 width 值     这个 .box 元素的实际大小就是 200px 。浏览

器会自动计算内容区的宽度为 200px   -
- 元素的总高度 = 你设置的 height 值
10px*2    -  2px*2 = 156px  。

3.1盒子模型（尺寸大小 与 占据的空间）

- 盒子的大小/尺寸                           • 盒子占据的空间

- 盒子的大小或尺寸”指的是元素在     • margin 决定的是盒子周围需要留出
页面上可见并占据的区域，这个区  多少空白，也就是它会推开其他元
域可以有背景色、边框等。     素多远。

- 这个大小是由 Content + Padding    • 所以，一个元素在页面布局中总共
+ Border 决定的。margin 在这个  占据的空间是 Content + Padding
区域的外部。               + Border + Margin。

3.1 盒子模型(边框)

- 盒子模型中的margin和padding属性比较简单，只能设置其大小。

- 边框可以设置宽度、颜色和样式。border属性主要有三个：border-width、
border-color、border-style。

- 其中border-style属性在不同的浏览器中，如IE、Firefox和Chrom等中略有差别。

3.1 盒子模型（属性的缩写）

- 盒子边界、填充或边框宽度的缩写

- 如只给定一个值，则表示其上下左右的值都相同

- 如给定两个值，则分别表示上下、左右的值

- 如给定三个值，则分别表示上、左右、下的值

- 如给定四个值，则分别表示上、右、下、左的值

- 边框border属性的缩写

- border: border-width | border-style | border-color

- 可以分别设置border-style和border-color

- 可以类似这样：border-right-color 、border-top-color

3.1 盒子模型（属性的默认值）

- 大多数HTML元素的盒子属性（margin、padding、border-width）默认值为0。

- 有少数HTML元素的margin和padding的默认值 不为0，如：body、p、ul、li等。

- 表单元素中大部分input元素的边框属性默认值 不为0。

3.2 定位方式

➢标准文档流定位

➢层定位

➢浮动定位

3.2 定位方式

1.标准流定位

- 标准文档流（标准流或文档流）是指在不使用其他与排列和定位相关的特殊CSS
规则时，各种元素的排列规则。

- 浏览器会根据各个盒子在html中出现的顺序，按照元素类型（块元素或行元素）
的特性一个接一个的排列。

- 这种方式可用CSS属性position：static控制。

3.2 定位方式（标准流下定位）

1. 元素分类

- 块元素

块元素(block element)一般是其他元素的容器元素， div即是常见块元素，

其他如段落标签“p”、标题“h”。

- 行内元素

内联元素(inline element)一般都是基于语义级的基本元素。内联元素只能

容纳文本或者其他行内元素，常见内联元素" span " 、 "a"、图片元素"

img " 。

3.2 定位方式（标准流下定位）

1. 元素分类

- 行内块元素

行内块元素（inline-block）整体呈现为inline特征，但是其内容呈现block特

征。即多个行内块元素可以在一行排列，并且可以设置其高宽、边框、边距

等。

3.2 定位方式（标准流下定位）

2.元素类型转换

通过设置display属性可以将元素显示为某类元素，该属性常用的取值如下：

（1）取值none：元素不显示。

（2）取值block：显示为块元素。

（3）取值inline：显示为行元素。

（4）取值inline-block：显示为行内块元素。

例如：可以将a元素设置显示为inline-block类型，使其既具有block的高宽、边框、边距等特
征，又具有inline的同行排列的特征。

3.2 定位方式（标准流下定位）

3. 元素可见性

可以设置visibility属性控制元素是否可见。元素默认可见，如设置visibility:
hidden，则元素被隐藏。

注意：

- visibility: hidden 表示元素被隐藏，但是元素占位还在；

- display:none  表示元素不显示，其占位也不在文档流中了。

3.2 定位方式（标准流下定位）

行内元素之间的水平margin
span.left{
margin-right:30px;
background-color:#a9d6ff;
}
span.right{
margin-left:40px;
background-color:#eeb0b0;
}

margin-right          margin-left

span 1                                          span 2

3.2 定位方式（标准流下定位）

- 块级元素之间的竖直margin

<div style="margin-bottom:50px;">块元素1</div>
<div style="margin-top:30px;">块元素2</div>

块元素1          块元素1

margin-bottom:50px

margin-top:30px
块元素2
块元素2