# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path
import textwrap

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, PageBreak, Paragraph, Preformatted, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs" / "algorithm_course_trimmed"
OUT.mkdir(parents=True, exist_ok=True)
MD_PATH = OUT / "算法设计与分析_软件教学适配教学详解版.md"
PDF_PATH = OUT / "算法设计与分析_软件教学适配教学详解版.pdf"


def chapter(title: str, body: str) -> str:
    return f"\n---\n\n# {title}\n\n{textwrap.dedent(body).strip()}\n"


MATERIAL = """# 算法设计与分析：软件教学适配教学详解版

> 按《算法设计与分析》课程复习建议重编。定位是“可直接讲课的教材”，不是速查卡片：每章包含考试范围、讲解路线、算法思想、例题演算、伪代码、复杂度、软件场景、易错点和练习。

## 覆盖说明

| 复习建议要求 | 本版位置 | 处理方式 |
|---|---|---|
| 复杂度、递归式、递归树、空间复杂度 | 第1章 | 详讲分析模板和例题 |
| 分治法 | 第2章、第11章 | 二分、归并、快排、线性选择、棋盘覆盖、循环日程 |
| 动态规划 | 第3章、第11章 | LCS、0-1背包、矩阵连乘、最优BST |
| 贪心法 | 第4章、第11章 | 会场安排、Dijkstra、哈夫曼、最小生成树 |
| 回溯法 | 第5章、第11章 | 解空间树、n后、0-1背包、图着色、作业调度 |
| 分支限界 | 第6章、第11章 | 活结点表、布线、背包、TSP |
| 随机化算法 | 第7章 | 舍伍德、拉斯维加斯、蒙特卡罗、Miller-Rabin |
| P、NP、NPC | 第8章 | 概念、归约、工程处理 |
| 串与序列、KMP | 第9章、第11章 | next数组、匹配过程、与LCS区别 |

## 教师使用建议

一节课建议按这个节奏讲：先给软件场景，再抽象成算法问题，然后走小例子，最后写伪代码和复杂度。不要让学生只背结论，要让他们能解释“为什么这样设计”。
"""

MATERIAL += chapter("第1章 算法基础与复杂度分析", """
## 1.1 本章考点

算法五个特性、输入规模、基本操作、时间复杂度、空间复杂度、递归式、递归树。复杂度题通常独立考，也会嵌入综合题。

## 1.2 复杂度分析模板

1. 明确输入规模，例如数组长度 n、图的顶点数 V 和边数 E、字符串长度 m/n。
2. 找基本操作，例如比较、松弛、字符匹配、状态转移。
3. 数循环次数，嵌套循环相乘，顺序语句取最大。
4. 写递归式，例如 `T(n)=2T(n/2)+n`。
5. 说明空间，别漏递归栈、辅助数组、DP表、队列。

## 1.3 例题：三角形循环

```text
for i = 1..n:
    for j = 1..i:
        x = x + 1
```

讲解过程：内层不是每次 n 次，而是 1,2,...,n 次。总次数为 `n(n+1)/2`，所以时间复杂度 O(n^2)，空间复杂度 O(1)。

## 1.4 例题：对数循环

```text
i = 1
while i < n:
    i = i * 2
```

第 k 次后 `i=2^k`，停止条件为 `2^k >= n`，所以 k 约为 `log2 n`，时间复杂度 O(log n)。

## 1.5 递归树

归并排序的递归式为 `T(n)=2T(n/2)+n`。每一层总合并代价都是 n，层数为 log n，因此总时间 O(n log n)。若递归式为 `T(n)=3T(n/2)+n`，每层代价按 3/2 增长，叶子层占主导，复杂度为 `Theta(n^(log2 3))`。

## 1.6 软件场景

日志系统中查找某时间戳后的第一条记录。顺序扫描 O(n)，若日志按时间排序，则二分 O(log n)。对一亿条日志，二分约 27 次比较，这就是复杂度的工程意义。

## 练习

- 分析 `T(n)=T(n-1)+n`。
- 分析两层循环但内层每次乘2增长的伪代码。
- 说明递归版二分和循环版二分的空间差异。
""")

MATERIAL += chapter("第2章 递归与分治法", """
## 2.1 讲解路线

分治三步：分解、求解子问题、合并。课堂建议从二分查找讲“规模减半”，再讲归并排序的完整三步，最后用快速排序说明“划分不均会退化”。

## 2.2 二分查找

```text
BINARY-SEARCH(A, x):
    low = 0; high = n - 1
    while low <= high:
        mid = floor((low + high) / 2)
        if A[mid] == x: return mid
        else if A[mid] < x: low = mid + 1
        else: high = mid - 1
    return NOT_FOUND
```

例：在 `[2,5,8,12,16,23,38,56]` 中找 23。第一次 mid=3，A[mid]=12，去右半；第二次 mid=5，找到23。时间 O(log n)，空间 O(1)。输入必须有序。

## 2.3 归并排序

```text
MERGE-SORT(A, low, high):
    if low >= high: return
    mid = floor((low + high) / 2)
    MERGE-SORT(A, low, mid)
    MERGE-SORT(A, mid + 1, high)
    MERGE(A, low, mid, high)
```

例：`[8,3,2,9,7,1,5,4]` 先拆到单元素，再合并为 `[3,8] [2,9] [1,7] [4,5]`，继续合并为 `[2,3,8,9] [1,4,5,7]`，最后得到 `[1,2,3,4,5,7,8,9]`。

复杂度：`T(n)=2T(n/2)+O(n)`，时间 O(n log n)，辅助数组 O(n)，递归栈 O(log n)。归并排序稳定，适合外部排序和日志分片排序。

## 2.4 快速排序

快速排序选择 pivot，把数组划分为不大于 pivot 和不小于 pivot 的两部分。平均 O(n log n)，最坏 O(n^2)。工程中常用随机 pivot 或三数取中避免退化。

## 2.5 线性时间选择

找第 k 小元素不必完整排序。随机划分版本平均 O(n)，最坏 O(n^2)。中位数的中位数算法可保证最坏 O(n)，但实现复杂，考试更重思想和复杂度。

## 2.6 保留专题

循环日程赛通过复制小赛程表构造大赛程表；棋盘覆盖把 `2^k x 2^k` 棋盘分成四块并在中心放 L 形骨牌；大整数乘法可用 Karatsuba 把四次乘法降为三次乘法。这些都展示了分治不只用于排序。

## 练习

解释为什么归并排序稳定而快速排序通常不稳定。画出 `[4,1,3,2]` 的归并排序递归树。
""")

MATERIAL += chapter("第3章 动态规划", """
## 3.1 讲解路线

动态规划适合有最优子结构和重叠子问题的问题。讲课先比较分治和DP，再用 LCS 讲二维表，用 0-1 背包讲选择约束，用矩阵连乘讲区间DP。

## 3.2 DP五步

1. 定义状态。
2. 写状态转移。
3. 定义初始条件。
4. 确定计算顺序。
5. 说明答案位置和如何还原方案。

## 3.3 LCS

状态：`c[i][j]` 表示 `X[1..i]` 和 `Y[1..j]` 的 LCS 长度。

```text
if i == 0 or j == 0: c[i][j] = 0
else if X[i] == Y[j]: c[i][j] = c[i-1][j-1] + 1
else: c[i][j] = max(c[i-1][j], c[i][j-1])
```

例：`X=ABCBDAB`，`Y=BDCABA`，最终 LCS 长度为4，可能答案有 `BCBA` 或 `BDAB`。时间 O(mn)，空间 O(mn)。只求长度可用滚动数组降空间。

## 3.4 0-1背包

状态：`dp[i][w]` 表示前 i 个物品、容量 w 时最大价值。

```text
if weight[i] > w:
    dp[i][w] = dp[i-1][w]
else:
    dp[i][w] = max(dp[i-1][w], dp[i-1][w-weight[i]] + value[i])
```

容量 W=7，物品 `(1,1),(3,4),(4,5),(5,7)`，最终最大价值为9，选重量3和4的物品。时间 O(nW)，空间 O(nW)，一维优化时容量必须倒序。

## 3.5 矩阵连乘

状态 `m[i][j]` 表示 Ai 到 Aj 的最小乘法次数。转移为 `m[i][j]=min(m[i][k]+m[k+1][j]+p[i-1]p[k]p[j])`。复杂度 O(n^3)，空间 O(n^2)。软件类比是数据库查询计划和张量乘法顺序优化。

## 3.6 最优BST与凸多边形剖分

它们都是区间DP。共同特征：一个区间、一个切分点、左右两个子区间。考试中若不要求具体公式，也要能说出状态和决策。

## 易错点

LCS 的子序列不要求连续；0-1 背包一维优化要倒序；DP必须说明初始化和填表顺序。
""")

MATERIAL += chapter("第4章 贪心法", """
## 4.1 讲解路线

贪心每一步做当前最优选择，但必须证明这个选择能通向全局最优。课堂用会场安排讲交换论证，用Dijkstra讲图上的贪心，用哈夫曼讲堆的反复合并。

## 4.2 会场安排

策略：按结束时间升序排序，每次选择与已选活动兼容的最早结束活动。

```text
ACTIVITY-SELECT(S):
    sort S by finish time
    result = []
    last = -infinity
    for a in S:
        if a.start >= last:
            add a
            last = a.finish
```

正确性：若某个最优解第一个活动不是结束最早的 e，而是 a，用 e 替换 a 不会减少后续可选空间，因此存在以 e 开始的最优解。复杂度 O(n log n)。

## 4.3 Dijkstra

要求边权非负。每次从未确定顶点中选 dist 最小者，松弛其邻接边。

```text
DIJKSTRA(G, s):
    dist[s] = 0; others = infinity
    Q = priority queue
    while Q not empty:
        u = extract-min(Q)
        for each edge (u,v,w):
            if dist[v] > dist[u] + w:
                dist[v] = dist[u] + w
                parent[v] = u
```

邻接表+优先队列复杂度 O((V+E)logV)。不能处理负权边，因为已确定的最短距离可能被后来的负权路径推翻。

## 4.4 哈夫曼编码

每次合并权值最小的两棵树，得到最优前缀编码。核心结构是最小堆，复杂度 O(n log n)。软件场景是压缩、日志编码、协议字段编码。

## 4.5 最小生成树

Kruskal按边权从小到大选不成环的边；Prim每次把树外最近点加入树。注意它们和Dijkstra不同：Dijkstra求源点到各点最短路径，MST求连通所有点的最小总边权。
""")

MATERIAL += chapter("第5章 回溯法", """
## 5.1 讲解路线

回溯法在解空间树中做深度优先搜索，用约束条件剪掉不可行分支，用限界条件剪掉不可能更优的分支。复习建议特别强调搜索树、解空间树、解的形式和范围。

## 5.2 通用框架

```text
BACKTRACK(t):
    if t > n:
        output solution
        return
    for each candidate at level t:
        if constraint_ok:
            make choice
            BACKTRACK(t + 1)
            undo choice
```

## 5.3 n后问题

用 `x[t]` 表示第 t 行皇后的列。约束：不同列、不同主副对角线。4后问题最终有 `[2,4,1,3]` 和 `[3,1,4,2]` 两类解。最坏接近 O(n!)，剪枝能大幅减少实际搜索。

## 5.4 0-1背包回溯

每层决定一个物品选或不选。约束：当前重量不超过容量。限界：当前价值加剩余最大可能价值若不超过 best，则剪枝。约束判断可行性，限界判断值不值得继续。

## 5.5 图着色与作业调度

图着色每层给一个顶点染色，相邻顶点不能同色，最坏 O(m^n)。作业调度通常是排列树，剪枝依据是当前代价或代价下界。

## 易错点

忘记撤销选择会污染兄弟分支；子集树和排列树要先区分；回溯不只是暴力枚举，剪枝才是关键。
""")

MATERIAL += chapter("第6章 分支限界法", """
## 6.1 核心概念

分支限界也搜索解空间树，但常用队列或优先队列维护活结点。扩展结点是当前展开的结点，活结点是已生成未扩展的结点，死结点是不可能产生更优解的结点。

## 6.2 与回溯比较

| 维度 | 回溯 | 分支限界 |
|---|---|---|
| 搜索方式 | 深度优先 | 广度优先或优先队列 |
| 结构 | 递归栈 | 活结点表 |
| 目标 | 可行解/全部解 | 常用于最优解 |
| 剪枝 | 约束和限界 | 当前最优值和界 |

## 6.3 0-1背包分支限界

结点保存 level、weight、profit、bound。最大化问题中 bound 是乐观上界，若 `bound <= best` 则剪枝。优先队列可按 bound 从大到小扩展。

## 6.4 布线问题

网格最短路径可用队列式分支限界：起点入队，逐层扩展上下左右，第一次到达终点即为最短路径。若边代价不同，要改用优先队列或其他最短路径算法。

## 6.5 TSP

TSP暴力是 O(n!)。分支限界中，结点表示部分路径，用“当前路径代价 + 未访问城市的乐观下界”剪枝。最坏仍是指数级，但能减少大量无效搜索。
""")

MATERIAL += chapter("第7章 随机化算法", """
## 7.1 分类

| 类型 | 正确性 | 运行时间 | 例子 |
|---|---|---|---|
| 舍伍德 | 总正确 | 改善平均性能 | 随机快速排序 |
| 拉斯维加斯 | 总正确 | 随机 | 随机化n后 |
| 蒙特卡罗 | 可能错误 | 可控 | 素数概率测试 |

## 7.2 随机快速排序

随机选择 pivot 不改变排序结果，只降低持续最坏划分的概率，因此属于舍伍德算法。期望 O(n log n)，最坏仍可能 O(n^2)。

## 7.3 Miller-Rabin

Miller-Rabin 是蒙特卡罗素数测试。返回合数时结论可靠；返回可能为素数时有错误概率。重复 k 次可以把错误概率降到很低。工程上常用于密码学大素数筛选。

## 易错点

拉斯维加斯不出错但时间不确定；蒙特卡罗时间可控但可能出错；随机化算法仍要分析期望复杂度或错误概率。
""")

MATERIAL += chapter("第8章 P、NP与NP完全问题", """
## 8.1 核心概念

P：能在多项式时间内求解的问题。NP：给定候选解后能在多项式时间内验证的问题。NP-hard：至少和NP中所有问题一样难。NP-complete：既属于NP又是NP-hard。

## 8.2 讲解例子

TSP决策版：“是否存在一条长度不超过K的巡回路线？” 如果给定一条路线，可以快速验证它是否访问所有城市并计算长度，因此它属于NP。

## 8.3 工程处理

小规模可用回溯或分支限界；中等规模可用DP或剪枝；大规模常用贪心、近似、启发式、随机化；有时限的系统可使用 anytime 策略，时间到返回当前最好解。

## 易错点

NP不是“非多项式”的缩写；NP完全不等于完全不能解；证明NPC通常要先证明属于NP，再从已知NPC问题归约。
""")

MATERIAL += chapter("第9章 串与序列：KMP", """
## 9.1 朴素匹配

文本 T 长度 n，模式 P 长度 m。朴素算法每个起点都尝试匹配，最坏 O(nm)。

## 9.2 KMP思想

失配时不回退文本指针，而是利用模式串自己的最长相等前后缀移动模式指针。next数组只依赖模式串。

## 9.3 next表示例

模式串 `ababaca` 的最长相等前后缀长度为 `0,0,1,2,3,0,1`。

## 9.4 伪代码

```text
KMP-MATCH(T, P):
    next = BUILD-NEXT(P)
    i = 0; j = 0
    while i < len(T):
        if j == -1 or T[i] == P[j]:
            i++; j++
        else:
            j = next[j]
        if j == len(P): return i-j
    return NOT_FOUND
```

复杂度：构造 next O(m)，匹配 O(n)，总 O(n+m)。

## 9.5 与LCS区别

KMP找连续模式串位置；LCS找不一定连续的公共子序列。最长公共子串才要求连续。
""")

MATERIAL += chapter("第10章 综合题答题模板", """
## 10.1 算法设计综合题

1. 建模：输入、输出、约束、目标。
2. 选择范式：分治、DP、贪心、回溯、分支限界或随机化。
3. 核心思想：一句话说明为什么适用。
4. 伪代码：变量含义清楚。
5. 正确性说明：DP说明状态覆盖，贪心给交换论证，搜索说明解空间树。
6. 复杂度：时间和空间都写。

## 10.2 例题：功能排期

功能有成本和收益，迭代容量 W，求最大收益。建模为 0-1 背包：成本是重量，收益是价值，每个功能选或不选。状态 `dp[i][w]`，转移为选/不选第 i 个功能。复杂度 O(nW)。

## 10.3 图表题准备

递归树看每层代价；DP表练 LCS 和背包；搜索树练 n后和背包；活结点表练分支限界；Dijkstra写 dist 更新；KMP写 next 表。
""")

MATERIAL += chapter("第11章 讲解型例题详解", """
## 11.1 归并排序板书

```text
[6,1,5,2,4,3]
=> [6,1,5] + [2,4,3]
=> [6] + [1,5] + [2] + [4,3]
=> [6] + [1] + [5] + [2] + [4] + [3]
=> [1,5] + [3,4]
=> [1,5,6] + [2,3,4]
=> [1,2,3,4,5,6]
```

讲解：拆分层数 log n，每层合并所有元素一次，总代价 O(n log n)。

## 11.2 LCS填表局部示例

`X=ABCBDAB`，`Y=BDCABA`。若 `X[i]==Y[j]`，从左上角加1；否则取上方和左方最大。最终长度4。还原时从右下角往回走，相等则记录字符，不等则向较大的方向走。

## 11.3 0-1背包表

容量7，物品 `(1,1),(3,4),(4,5),(5,7)`，最终最大价值9。解释时逐行说明“放不下继承上一行；放得下比较选和不选”。

## 11.4 会场安排

活动按结束时间排序后，选结束最早且兼容者。例：A(1,4)、D(5,7)、H(8,11)、K(12,16) 可组成一组。证明用交换论证。

## 11.5 Dijkstra过程表

从 S 出发，先确定 S；若边 S-A=4、S-B=2，则 A=4、B=2；接着确定 B，并用 B 更新 A、C、D。每轮必须写“已确定集合、选中点、dist变化”。

## 11.6 KMP讲解

模式 `ababaca` 在 `ababa` 后失配时，可复用后缀 `aba` 等于前缀 `aba` 这一事实，因此文本指针不用回退，只移动模式指针。
""")

MATERIAL += chapter("第12章 练习题库与答案要点", """
## 12.1 简答题

题：分治和动态规划的异同。答案：都分解子问题；分治子问题通常独立，DP子问题重叠并保存结果。

题：贪心选择性质是什么。答案：存在一个全局最优解以当前贪心选择开始，常用交换论证证明。

题：约束条件和限界条件区别。答案：约束判断可行性，限界判断是否可能更优。

## 12.2 复杂度题

三层循环中第三层固定10次，复杂度仍是 O(n^2)。`T(n)=2T(n/2)+1` 的递归树结点总数为 O(n)。`T(n)=T(n-1)+n` 为 O(n^2)。

## 12.3 算法设计题

会议安排：按结束时间排序，贪心选择兼容活动，O(n log n)。  
LCS：二维DP，O(mn)。  
功能排期：0-1背包，O(nW)。  
最短路径：非负权图用Dijkstra，优先队列 O((V+E)logV)。  
字符串匹配：KMP，O(n+m)。

## 12.4 判断题

0-1背包一维优化容量应从大到小枚举，对。随机快排最坏仍可能 O(n^2)，对。NP问题都不能求解，错。LCS必须连续，错。
""")

MATERIAL += chapter("第13章 分治法课堂讲稿扩展", """
## 13.1 从问题到分治

教师可以先问学生：如果一个文件有100GB，内存只有8GB，怎么排序？学生通常会想到“分块”。这时引出分治：先把大问题分成能处理的小问题，每块内部排序，再把多个有序块合并。这就是外部归并排序。

## 13.2 归并排序逐步讲解

输入 `[9,4,7,1,3,6,2,8]`。

```text
第1层: [9,4,7,1] + [3,6,2,8]
第2层: [9,4]+[7,1] + [3,6]+[2,8]
第3层: [9]+[4]+[7]+[1]+[3]+[6]+[2]+[8]
合并: [4,9]+[1,7]+[3,6]+[2,8]
合并: [1,4,7,9]+[2,3,6,8]
合并: [1,2,3,4,6,7,8,9]
```

板书时重点画出“每层所有合并合起来都是 n 个元素”，这样学生自然得到 O(n log n)。

## 13.3 快速排序逐步讲解

输入 `[9,4,7,1,3,6,2,8]`，选 pivot=9 时第一次划分极不均衡；选 pivot=4 时较均衡：

```text
<=4: [1,3,2]
pivot: 4
>4: [9,7,6,8]
```

讲解提问：为什么随机pivot能改善平均情况？因为输入顺序不再固定决定划分质量，恶意或特殊输入触发退化的概率降低。

## 13.4 线性选择讲稿

如果只要第 k 小，排序整个数组是浪费。快速选择每次只递归进入包含第 k 小的那一侧。平均情况下每轮丢掉一部分元素，总期望 O(n)。但如果划分总是极不均衡，仍会退化到 O(n^2)。

## 13.5 棋盘覆盖讲稿

把缺一格的 `2^k x 2^k` 棋盘分成四块。缺格所在块天然满足子问题；其他三块没有缺格，于是在中心放一个L形骨牌，让它们各缺一个中心格。于是四块都变成同类问题。这个例子能训练学生“人为制造同构子问题”的能力。
""")

MATERIAL += chapter("第14章 动态规划课堂讲稿扩展", """
## 14.1 为什么学生觉得DP难

DP难点不在公式，而在状态定义。教师讲课时不要先给公式，而要先问：“如果我只看前 i 个元素、容量 j，是否能完整描述一个子问题？”一旦状态能描述子问题，转移式就自然出现。

## 14.2 LCS完整填表

`X=ABCBDAB`，`Y=BDCABA`。局部表如下：

| i/j | 0 | B | D | C | A | B | A |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| B | 0 | 1 | 1 | 1 | 1 | 2 | 2 |
| C | 0 | 1 | 1 | 2 | 2 | 2 | 2 |
| B | 0 | 1 | 1 | 2 | 2 | 3 | 3 |

讲解时每填一个格子都问：当前两个末尾字符是否相等？相等看左上，不等看上和左。最后还原路径时，从右下角走回左上角。

## 14.3 背包完整填表

容量7，物品 `(1,1),(3,4),(4,5),(5,7)`：

| i/j | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2 | 0 | 1 | 1 | 4 | 5 | 5 | 5 | 5 |
| 3 | 0 | 1 | 1 | 4 | 5 | 6 | 6 | 9 |
| 4 | 0 | 1 | 1 | 4 | 5 | 7 | 8 | 9 |

答案是9，选择第2和第3个物品。反推方法：从右下角开始，如果 `dp[i][j] == dp[i-1][j]`，说明第 i 个没选；否则选了第 i 个，容量减去它的重量。

## 14.4 矩阵连乘讲稿

矩阵相乘的结果不受加括号影响，但代价受影响。例如 A1=10x100，A2=100x5，A3=5x50：

```text
(A1A2)A3: 10*100*5 + 10*5*50 = 7500
A1(A2A3): 100*5*50 + 10*100*50 = 75000
```

差了10倍。区间DP的核心是枚举最后一次切分位置 k。

## 14.5 DP答题句式

“令 dp[i][j] 表示……。当……时，转移为……；否则……。边界为……。按……顺序填表。答案为……。时间复杂度为……，空间复杂度为……。”
""")

MATERIAL += chapter("第15章 贪心与图算法课堂讲稿扩展", """
## 15.1 会场安排反例导入

如果按开始时间最早选，活动 A(1,10) 会占满全天，导致只能选一个；但如果选结束最早，可以选多个短活动。因此贪心策略不是凭直觉，而要能证明。

## 15.2 会场安排过程表

| 活动 | 开始 | 结束 | 是否选择 |
|---|---:|---:|---|
| A | 1 | 4 | 选 |
| B | 3 | 5 | 与A冲突 |
| C | 0 | 6 | 与A冲突 |
| D | 5 | 7 | 选 |
| E | 5 | 9 | 与D冲突 |
| H | 8 | 11 | 选 |
| K | 12 | 16 | 选 |

最后选择 A,D,H,K。

## 15.3 Dijkstra过程表

假设边：S-A=4，S-B=2，B-A=1，A-C=3，B-C=5，C-D=4，D-E=2，C-E=6。

| 步骤 | 选中点 | dist变化 |
|---|---|---|
| 1 | S | A=4, B=2 |
| 2 | B | A=min(4,3)=3, C=7 |
| 3 | A | C=min(7,6)=6 |
| 4 | C | D=10, E=12 |
| 5 | D | E=min(12,12)=12 |
| 6 | E | 结束 |

课堂强调：每次选的是当前 dist 最小的未确定顶点，不是边权最小的边。

## 15.4 哈夫曼编码过程

字符频率 A=5，B=9，C=12，D=13，E=16，F=45。先合并5和9得14，再合并12和13得25，再合并14和16得30，继续直到一棵树。高频字符离根近，编码短。

## 15.5 MST与Dijkstra区别

Dijkstra关注从一个源点到所有点的最短路径；最小生成树关注连通所有点的边权总和最小。两者都用贪心，但目标函数完全不同。
""")

MATERIAL += chapter("第16章 搜索算法课堂讲稿扩展", """
## 16.1 解空间树

搜索题先问三个问题：解是什么形式？每层决定什么？什么时候剪枝？0-1背包是子集树，作业调度和TSP常是排列树。

## 16.2 n后问题4阶演示

第一行放第1列后，第二行第1列同列剪枝，第2列对角线剪枝，第3列可放；继续到第三行发现无合法位置，回溯到第二行改放第4列。最终解包括 `[2,4,1,3]` 和 `[3,1,4,2]`。

## 16.3 背包回溯树

每层一个物品，左分支选，右分支不选。若当前重量超过容量，剪枝；若当前价值加剩余理论最大价值不超过best，也剪枝。

## 16.4 分支限界背包

回溯通常沿一条路走到底；分支限界把多个活结点放在表里，可以用优先队列优先扩展上界最高的结点。结点字段通常包括 level、weight、profit、bound。

## 16.5 TSP分支限界

部分路径的当前代价已经很高时，需要估计未访问城市至少还要付出的代价。如果“当前代价+下界”已经不可能优于best，整棵子树剪掉。

## 16.6 布线问题

网格等权最短路可用队列式分支限界，类似BFS。讲课时可以把每个格子的距离写在格子里，再从终点按距离递减回溯路径。
""")

MATERIAL += chapter("第17章 KMP与串序列课堂讲稿扩展", """
## 17.1 从朴素匹配的问题讲起

文本是 `aaaaaaaaab`，模式是 `aaaab`。朴素匹配每次几乎匹配到最后才失败，导致大量重复比较。KMP的目标就是避免文本指针回退。

## 17.2 前后缀讲解

模式 `ababaca`：

| 子串 | 最长相等前后缀长度 |
|---|---:|
| a | 0 |
| ab | 0 |
| aba | 1 |
| abab | 2 |
| ababa | 3 |
| ababac | 0 |
| ababaca | 1 |

如果已经匹配 `ababa` 后失配，后缀 `aba` 等于前缀 `aba`，所以模式串可以直接滑到复用位置。

## 17.3 与LCS对比

KMP要找的是连续模式串出现的位置；LCS要找两个序列中保持相对顺序但不要求连续的最长公共部分。日志关键字查找用KMP；版本diff更接近LCS。

## 17.4 答题模板

先说明 next 数组含义，再写匹配过程，最后说明 i 不回退，因此总时间 O(n+m)。
""")

MATERIAL += chapter("第18章 期末题型训练", """
## 18.1 简答题模板

问概念时不要只背一句话，要给一个例子。比如问“什么是重叠子问题”，可以说 LCS 中 `c[i][j]` 会被多个递归分支反复使用，所以适合保存成表。

## 18.2 图表题模板

Dijkstra表要包含已确定集合、当前选中点、dist更新。DP表要包含边界行列。搜索树要标出剪枝原因。KMP next表要写出前后缀依据。

## 18.3 综合题模板

```text
输入:
输出:
算法思想:
伪代码:
正确性:
复杂度:
```

## 18.4 常见扣分点

- 只写伪代码，不写复杂度。
- 只写复杂度，不解释 n、m、V、E、W 的含义。
- 贪心题不给证明。
- DP题没有状态定义。
- 回溯题没有说明约束和限界。
- KMP题把子串和子序列混淆。
""")

MATERIAL += "\n---\n\n# 最后一页速记\n\n| 范式 | 一句话识别 | 典型题 |\n|---|---|---|\n| 分治 | 拆成独立同类子问题，再合并 | 二分、归并、快排 |\n| DP | 最优子结构 + 重叠子问题 | LCS、背包、矩阵连乘 |\n| 贪心 | 每步局部最优且可证明 | 会场、Dijkstra、哈夫曼 |\n| 回溯 | DFS枚举解空间树并剪枝 | n后、图着色、背包 |\n| 分支限界 | 活结点表 + 上界/下界 | TSP、布线、背包 |\n| 随机化 | 随机改善性能或控制错误率 | 随机快排、素数测试 |\n| NP/NPC | 快速验证但难快速求解 | TSP、SAT |\n| KMP | 前后缀避免文本指针回退 | 字符串匹配 |\n"


def register_fonts() -> tuple[str, str]:
    regular = Path(r"C:/Windows/Fonts/msyh.ttc")
    bold = Path(r"C:/Windows/Fonts/msyhbd.ttc")
    pdfmetrics.registerFont(TTFont("CN", str(regular)))
    pdfmetrics.registerFont(TTFont("CN-Bold", str(bold if bold.exists() else regular)))
    return "CN", "CN-Bold"


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class Doc(BaseDocTemplate):
    def __init__(self, filename: Path):
        super().__init__(str(filename), pagesize=A4, leftMargin=17 * mm, rightMargin=17 * mm, topMargin=15 * mm, bottomMargin=16 * mm)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="normal")
        self.addPageTemplates(PageTemplate(id="main", frames=[frame], onPage=self.header_footer))

    def header_footer(self, canvas, doc):
        canvas.saveState()
        canvas.setFont("CN", 8)
        canvas.setFillColor(colors.HexColor("#667780"))
        canvas.drawString(17 * mm, A4[1] - 10 * mm, "算法设计与分析：软件教学适配教学详解版")
        canvas.drawRightString(A4[0] - 17 * mm, 9 * mm, str(doc.page))
        canvas.setStrokeColor(colors.HexColor("#D8E0E4"))
        canvas.line(17 * mm, A4[1] - 12 * mm, A4[0] - 17 * mm, A4[1] - 12 * mm)
        canvas.restoreState()


def styles():
    _, bold = register_fonts()
    sample = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("TitleCN", parent=sample["Title"], fontName=bold, fontSize=22, leading=29, alignment=TA_CENTER, textColor=colors.HexColor("#17324D"), spaceAfter=12),
        "h1": ParagraphStyle("H1CN", parent=sample["Heading1"], fontName=bold, fontSize=16, leading=22, textColor=colors.HexColor("#17324D"), spaceBefore=10, spaceAfter=7),
        "h2": ParagraphStyle("H2CN", parent=sample["Heading2"], fontName=bold, fontSize=12.5, leading=18, textColor=colors.HexColor("#245C73"), spaceBefore=7, spaceAfter=4),
        "body": ParagraphStyle("BodyCN", parent=sample["BodyText"], fontName="CN", fontSize=9.6, leading=15.2, spaceAfter=4),
        "code": ParagraphStyle("CodeCN", fontName="CN", fontSize=8.4, leading=11.5, leftIndent=8, backColor=colors.HexColor("#F5F7F8"), borderColor=colors.HexColor("#D7E0E4"), borderWidth=0.4, borderPadding=5, spaceAfter=6),
        "cell": ParagraphStyle("CellCN", parent=sample["BodyText"], fontName="CN", fontSize=8.4, leading=12),
        "cellh": ParagraphStyle("CellHCN", parent=sample["BodyText"], fontName="CN-Bold", fontSize=8.4, leading=12),
    }


def table_from(lines: list[str], st: dict) -> Table:
    rows = []
    for line in lines:
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if all(set(c) <= {"-", ":"} for c in cells):
            continue
        rows.append(cells)
    cols = max(len(r) for r in rows)
    width = A4[0] - 34 * mm
    data = []
    for i, row in enumerate(rows):
        row += [""] * (cols - len(row))
        style = st["cellh"] if i == 0 else st["cell"]
        data.append([Paragraph(esc(c), style) for c in row])
    tbl = Table(data, colWidths=[width / cols] * cols, hAlign="LEFT")
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DDECEF")),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#B8C8CE")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return tbl


def story_from_md(md: str):
    st = styles()
    story = []
    lines = md.splitlines()
    i = 0
    code = None
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("```"):
            if code is None:
                code = []
            else:
                story.append(Preformatted("\n".join(code), st["code"]))
                code = None
            i += 1
            continue
        if code is not None:
            code.append(line)
            i += 1
            continue
        if not line.strip():
            story.append(Spacer(1, 3))
            i += 1
            continue
        if line.strip() == "---":
            story.append(PageBreak())
            i += 1
            continue
        if line.startswith("|"):
            tbl_lines = []
            while i < len(lines) and lines[i].startswith("|"):
                tbl_lines.append(lines[i])
                i += 1
            story.append(table_from(tbl_lines, st))
            story.append(Spacer(1, 7))
            continue
        if line.startswith("# "):
            story.append(Paragraph(esc(line[2:].strip()), st["title"]))
        elif line.startswith("## "):
            story.append(Paragraph(esc(line[3:].strip()), st["h2"]))
        elif line.startswith("#"):
            level = len(line) - len(line.lstrip("#"))
            story.append(Paragraph(esc(line[level:].strip()), st["h1"]))
        elif line.lstrip().startswith("- "):
            story.append(Paragraph(esc(line.strip()), st["body"]))
        else:
            story.append(Paragraph(esc(line.strip()), st["body"]))
        i += 1
    return story


def main() -> None:
    MD_PATH.write_text(MATERIAL, encoding="utf-8")
    doc = Doc(PDF_PATH)
    doc.build(story_from_md(MATERIAL))
    print(MD_PATH)
    print(PDF_PATH)


if __name__ == "__main__":
    main()
