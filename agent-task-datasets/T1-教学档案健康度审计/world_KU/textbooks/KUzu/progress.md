# 当前页码：第 97 页

---

## 2026-10-14 | 遐蝶
<!-- sourceConversationId:cU1RL7c1AIn6t60quQTCb -->
p.22-97 | Spring In Action - 本节课
<!-- sourceConversationId: -->


先补上节遗留：`save()` 为何标 `@Transactional`。遐蝶用三层写入链讲解——插 `Taco_Order` 取回 `orderId`、为每个 `Taco` 插行取 `tacoId`、为每条配料插 `Ingredient_Ref` 连线；每段依赖上一段的 id，中途失败会留下无 taco 的残缺订单。事务边界使整体写或整体不写。学习者接受，未复述。

3.2 转向 Spring Data JDBC：列 Spring Data 家族（JPA/MongoDB/Neo4j/Redis 等），核心是只写接口、运行时自动生成实现。问"两个手写实现类的下场"，学习者答"变成 Repository 的继承类，统一管理"——前半对（统一到接口继承），漏了"实现类整个删除"。遐蝶补足并给出 `IngredientRepository extends CrudRepository<Ingredient, String>` 的写法，`CrudRepository` 内置 `findAll`/`findById`/`save`。

推 `OrderRepository` 写法，学习者答 `CrudRepository<TacoOrder, Long>`——两个类型参数均正确，仅把 `CrudRepository` 误拼为 `CrudRepositrory`，已轻声纠正。

3.2.3 实体注解：`@Id`、`@Table`（可选，默认类名对应表，如 `@Table("Taco_Cloud_Order")`）、`@Column` 指定列名、`Ingredient implements Persistable<String>`（教材只给写法未展开）、`IngredientRef` 无标识列不标 `@Id`。

未解决：`TacoOrder` 不加 `@Table` 时默认查哪张表、要改查 `Taco_Cloud_Order` 该怎么写——最后提出，学习者未答，下次先补此问。

---

## 2026-10-13 | 珐露珊
<!-- sourceConversationId:KfG43v-cJLlvThdB6I4bv -->
p.22-88 | Spring In Action - 本节课
<!-- sourceConversationId: -->


进入第 3 章。清单 3.1/3.2 对比：学习者答对 `JdbcTemplate` 是"既省打字、又把底层动作挪了位置"，托帕补上异常被转成运行时异常这层。`Optional` 返回值一问答对——"防止调用方忘记处理空可能结果"，托帕进而讲清它是把"可能找不到"写进签名、把运行时隐患提前到编译期可见。
3.1.1/3.1.2：Taco 加 `id`/`createdAt`、TacoOrder 加 `id`/`placedAt`；固定 H2 库名的理由一问答对（登录 H2 控制台要确定 URL）。存储库接口三方法，实现类用 `@Repository`+构造器注入 `JdbcTemplate`——注入方式一问答对。`RowMapper` 函数式接口一题，学习者查源码后答"单函数接口，方法引用是 lambda/匿名内部类简写"，方向正确，托帕纠细节"方法引用本身就是 lambda 简写，不必再包一层"。`query()`/`update()` 用法、`mapRowToIngredient`、清单 3.7/3.8 接线讲解。
3.1.3 建表与预加载：`Ingredient_Ref` 为何要多一张表——学习者答"减少复杂度"不对，托帕纠正真正原因是拆多对多（Taco_Order/Taco 同一聚合，Taco 不能脱离 order；Ingredient 独立聚合）。`schema.sql`/`data.sql` 的自动执行机制一问答对（自动配置）。指出教材页 85 漏列 `taco_key` 的小笔误。
3.1.4 插入数据：`OrderRepository.save()` 三层写入链（order→taco→ingredientRef）；`GeneratedKeyHolder` 取回数据库生成 id，学习者答"jdbc 查找"，托帕纠正为插入时用 `setReturnGeneratedKeys`/`getGeneratedKeys` 顺带取回，并说明构造函数用 `JdbcOperations` 是松耦合。
未解决：`save()` 为何必须标 `@Transactional`（三层写入半途出错会留下什么）——最后提出，学习者未答，下次先补此问再往下。

---

## 2026-10-06 | 玛薇卡
<!-- sourceConversationId:nUtjMBmtqzUJQ6YiLBJ-P -->
p.22-66 | Spring In Action - 本节课
清单 2.5 设计页与 Thymeleaf 渲染：学习者答对循环内 `${ingredient.id}` 每圈不同（"循环是对同一类的配料列举，每圈是另一个对象"）；又正确推出五个 Model 键名来自 `Ingredient.Type` 枚举（`toString().toLowerCase()`），摸清控制器放键名与模板取值的接缝。
表单提交：识别 @GetMapping 只认 GET 导致 405，主动答"补一个 POST 请求处理"；理解表单不写 action 默认提交回显示它的 URL（/orders/current），而 orderForm.html 必须显式写 `th:action="@{/orders}"` 送到 /orders，学习者判断准确。转换器 `IngredientByIdConverter` 需 id→对象映射表，答对。
验证：理解 if/then 手动检查繁琐，改用 Java Bean Validation 注解。`@NotNull` 守"存在"、`@Size` 守"规模"，学习者初答把 @Size 说成"守格式"，已校准。`@NotBlank` vs `@NotNull` 对纯空格输入的区别答对（前者拦住、后者放行）。讲了 `@Valid`+`Errors`+`errors.hasErrors()` 流程。
未解决：`Errors` 参数为何必须紧跟被验证对象、挪到参数列表最前会怎样——本节课最后提出，学习者未作答，下次可先补这一问，再进 2.3.3 视图层显示验证错误。
