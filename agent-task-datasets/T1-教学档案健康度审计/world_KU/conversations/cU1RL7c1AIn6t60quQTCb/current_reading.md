<!-- startPage: 80 endPage: 98 -->
--- 第 80 页 ---
80
package tacos.data;
import java.util.Optional;
import tacos.Ingredient;
public interface IngredientRepository {
Iterable<Ingredient> findAll();
Optional<Ingredient> findById(String id);
Ingredient save(Ingredient ingredient);
}
尽管该接口体现了需要 Ingredient repository 做的事情的本质，但是仍然需要编写一个使用 JdbcTemplate 来查
询数据库的 IngredientRepository 的实现。下面的程序清单是编写实现的第一步。
程序清单 3.4 使用 JdbcTemplate 开始编写 Ingredient repository
package tacos.data;
import java.sql.ResultSet;
import java.sql.SQLException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tacos.Ingredient;
@Repository
public class JdbcIngredientRepository implements IngredientRepository {
private JdbcTemplate jdbcTemplate;
public JdbcIngredientRepository(JdbcTemplate jdbcTemplate) {
this.jdbcTemplate = jdbcTemplate;
}
// ...
}
可以看到，JdbcIngredientRepository 使用了 @Repository 注解。这个注解是 Spring 定义的少数几个原型注解
之一，包括 @Controller 和 @Component 。通过使用 @Repository 对 JdbcIngredientRepository 进行注解，这样它
就会由 Spring 组件在扫描时自动发现，并在 Spring 应用程序上下文中生成 bean 实例。
当 Spring 创建 JdbcIngredientRepository bean 时，通过 @Autowired 注解将 JdbcTemplate 注入到 bean 中。如
果有多个构造函数，或者如果您只想显式地注入，那么可以使用 @Autowired ：
@Autowired
public JdbcIngredientRepository(JdbcTemplate jdbcTemplate) {
this.jdbcTemplate = jdbcTemplate;
}
构造函数将 JdbcTemplate 分配给一个实例变量，该变量将在其他方法中用于查询和插入数据库。谈到那些其他
方法，让我们来看看 findAll() 和 findById() 的实现。
程序清单 3.5 使用 JdbcTemplate 查询数据库

--- 第 81 页 ---
81
@Override
public Iterable<Ingredient> findAll() {
return jdbcTemplate.query(
"select id, name, type from Ingredient",
this::mapRowToIngredient);
}
@Override
public Optional<Ingredient> findById(String id) {
List<Ingredient> results = jdbcTemplate.query(
"select id, name, type from Ingredient where id=?",
this::mapRowToIngredient,
id);
return results.size() == 0 ?
Optional.empty() :
Optional.of(results.get(0));
}
private Ingredient mapRowToIngredient(ResultSet row, int rowNum)
throws SQLException {
return new Ingredient(
row.getString("id"),
row.getString("name"),
Ingredient.Type.valueOf(row.getString("type")));
}
findAll() 和 findById() 都以类似的方式使用 JdbcTemplate。期望返回对象集合的 findAll() 方法使用了
JdbcTemplate 的 query() 方法。 query() 方法接受查询的 SQL 以及 Spring 的 RowMapper 实现，以便将结果
集中的每一行映射到一个对象。 findAll() 还接受查询中所需的所有参数的列表作为它的最后一个参数。但是，
在本例中，没有任何必需的参数。
相反， 相反， findById() 方法需要在其查询中包含 where 子句，以比较 id 列的值与传递给方法的 id 参数的
值。因此对 query() 的调用包括 id 参数。当查询执行时，“？”将被替换为此值。
如程序清单 3.5 所示， findAll() 和 findById() 的 RowMapper 参数作为 mapRowToIngredient() 方法的方法引
用。当使用 JdbcTemplate 作为显式 RowMapper 实现的替代方案时，使用 Java 8 的方法引用和 lambda 非常
方便。但是，如果出于某种原因，想要或是需要一个显式的 RowMapper，那么以下的 findById() 实现将展示
如何做到这一点：
@Override
public Ingredient findById(String id) {
return jdbcTemplate.queryForObject(
"select id, name, type from Ingredient where id=?",
new RowMapper<Ingredient>() {
public Ingredient mapRow(ResultSet rs, int rowNum)
throws SQLException {
return new Ingredient(
rs.getString("id"),
rs.getString("name"),
Ingredient.Type.valueOf(rs.getString("type")));
};
}, id);
}
从数据库读取数据只是问题的一部分。在某些情况下，必须将数据写入数据库以便能够读取。因此，让我们来
看看如何实现 save() 方法。
插入一行

--- 第 82 页 ---
82
JdbcTemplate 的 update() 方法可用于在数据库中写入或更新数据的任何查询。并且，如下面的程序清单所
示，它可以用来将数据插入数据库。
程序清单 3.6 使用 JdbcTemplate 插入数据
@Override
public Ingredient save(Ingredient ingredient) {
jdbcTemplate.update(
"insert into Ingredient (id, name, type) values (?, ?, ?)",
ingredient.getId(),
ingredient.getName(),
ingredient.getType().toString());
return ingredient;
}
因为没有必要将 ResultSet 数据映射到对象，所以 update() 方法要比 query() 简单得多。它只需要一个包含
SQL 的字符串来执行，以及为任何查询参数赋值。在本例中，查询有三个参数，它们对应于 save() 方法的最
后三个参数，提供了 Ingredient 的 id、name 和 type。
完成了 JdbcIngredientRepository 后，现在可以将其注入到 DesignTacoController 中，并使用它来提供一个
Ingredient 对象列表，而不是使用硬编码的值（正如第 2 章中所做的那样）。DesignTacoController 的变化如下
所示。
程序清单 3.7 在控制器中注入并使用 repository
@Controller
@RequestMapping("/design")
@SessionAttributes("tacoOrder")
public class DesignTacoController {
private final IngredientRepository ingredientRepo;
@Autowired
public DesignTacoController(
IngredientRepository ingredientRepo) {
this.ingredientRepo = ingredientRepo;
}
@ModelAttribute
public void addIngredientsToModel(Model model) {
Iterable<Ingredient> ingredients = ingredientRepo.findAll();
Type[] types = Ingredient.Type.values();
for (Type type : types) {
model.addAttribute(type.toString().toLowerCase(),
filterByType(ingredients, type));
}
}
// ...
}
请注意， addIngredientsToModel() 方法的第 2 行现在调用了注入的 IngredientRepository 的 findAll() 方
法。 findAll() 方法从数据库中提取所有 Ingredient，然后将它们对应到到模型的不同类型中。
现在我们有了一个 IngredEnterpository 来从数据库中提取配料对象，我们还可以简化我们在第 2 章中创建的
IngredientByIdConverter，替换其中硬编码的配料 Map，通过简单调用 IngredientRepository.findById() 方法：
程序清单 3.8 简化的 IngredientByIdConverter

--- 第 83 页 ---
83
package tacos.web;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.convert.converter.Converter;
import org.springframework.stereotype.Component;
import tacos.Ingredient;
import tacos.data.IngredientRepository;
@Component
public class IngredientByIdConverter implements Converter<String, Ingredient> {
private IngredientRepository ingredientRepo;
@Autowired
public IngredientByIdConverter(IngredientRepository ingredientRepo) {
this.ingredientRepo = ingredientRepo;
}
@Override
public Ingredient convert(String id) {
return ingredientRepo.findById(id).orElse(null);
}
}
几乎已经准备好启动应用程序，并测试这些更改了。但是在开始从 Ingredient 表查询数据之前，应该先创建这
个表，并写入一些 Ingredient 数据。

--- 第 84 页 ---
84
3.1.3 定义 schema 并预加载数据
除了 Ingredient 表之外，还需要一些保存订单和设计信息的表。图 3.1 说明了需要的表以及这些表之间的关系。
图 3.1 Taco Cloud Schema
图 3.1中的表有以下用途：
Taco_Order - 保存着重要的订单细节
Taco - 保存着关于 taco 设计的重要信息
Ingredient_Ref - 包含 Taco 表中每一行的一个或多行数据，将 Taco 映射到该 Taco 的 Ingredient
Ingredient - 保存着原料信息
在我们的应用程序中，Taco 不能存在于 Taco_Order 的上下文之外。因此，Taco_Order 和 Taco 聚合关系，其
中 Taco_Order 是聚合根。另一方面，Ingredient 对象是其自身聚合的唯一成员，并且 Taco 通过
Ingredient_Ref 引用。
注意：聚合和聚合根是领域驱动设计的核心概念，是一种设计方法，它提倡软件代码应与业务域匹配。虽
然在 Taco Cloud 领域对象中，我们只简单应用领域驱动设计（DDD），但 DDD 不只是聚合和聚合根。
更多信息请阅读 Eric Evans 的开创性作品《领域驱动设计: 软件核心复杂性应对之道》。
下一个程序清单显示了创建表的 SQL 语句。
程序清单 3.9 定义 Taco Cloud 模式

--- 第 85 页 ---
85
create table if not exists Taco_Order (
id identity,
delivery_Name varchar(50) not null,
delivery_Street varchar(50) not null,
delivery_City varchar(50) not null,
delivery_State varchar(2) not null,
delivery_Zip varchar(10) not null,
cc_number varchar(16) not null,
cc_expiration varchar(5) not null,
cc_cvv varchar(3) not null,
placed_at timestamp not null
);
create table if not exists Taco (
id identity,
name varchar(50) not null,
taco_order bigint not null,
taco_order_key bigint not null,
created_at timestamp not null
);
create table if not exists Ingredient_Ref (
ingredient varchar(4) not null,
taco bigint not null,
taco_key bigint not null
);
create table if not exists Ingredient (
id varchar(4) not null,
name varchar(25) not null,
type varchar(10) not null
);
alter table Taco
add foreign key (taco_order) references Taco_Order(id);
alter table Ingredient_Ref
add foreign key (ingredient) references Ingredient(id);
最大的问题是把这个 Schema 定义放在哪里。事实上，Spring Boot 已经有答案。
如果有一个名为 schema.sql 的文件。在应用程序的类路径根目录下执行 sql，然后在应用程序启动时对数据库
执行该文件中的 SQL。因此，应该将程序清单 3.8 的内容写入一个名为 schema.sql 的文件中，然后放在项目的
src/main/resources 文件夹下。
还需要用一些 Ingredient 数据来预加载数据库。幸运的是，Spring Boot 还将执行一个名为 data.sql 的文件，这
个文件位于根路径下。因此，可以使用 src/main/resources/data.sql 中的下面程序清单中的 insert 语句来加载包
含 Ingredient 数据的数据库。
程序清单 3.10 预加载数据库

--- 第 86 页 ---
86
delete from Ingredient_Ref;
delete from Taco;
delete from Taco_Order;
delete from Ingredient;
insert into Ingredient (id, name, type)
values ('FLTO', 'Flour Tortilla', 'WRAP');
insert into Ingredient (id, name, type)
values ('COTO', 'Corn Tortilla', 'WRAP');
insert into Ingredient (id, name, type)
values ('GRBF', 'Ground Beef', 'PROTEIN');
insert into Ingredient (id, name, type)
values ('CARN', 'Carnitas', 'PROTEIN');
insert into Ingredient (id, name, type)
values ('TMTO', 'Diced Tomatoes', 'VEGGIES');
insert into Ingredient (id, name, type)
values ('LETC', 'Lettuce', 'VEGGIES');
insert into Ingredient (id, name, type)
values ('CHED', 'Cheddar', 'CHEESE');
insert into Ingredient (id, name, type)
values ('JACK', 'Monterrey Jack', 'CHEESE');
insert into Ingredient (id, name, type)
values ('SLSA', 'Salsa', 'SAUCE');
insert into Ingredient (id, name, type)
values ('SRCR', 'Sour Cream', 'SAUCE');
即使只开发了配料数据的 repository，也可以启动 Taco Cloud 应用程序并访问设计页面，查看
JdbcIngredientRepository 的运行情况。大胆的试试吧。后续可以继续编写用于持久化 Taco、TacoOrder 的
repository。

--- 第 87 页 ---
87
3.1.4 插入数据
到此，已经了解了如何使用 JdbcTemplate 向数据库写入数据。JdbcIngredientRepository 中的 save() 方法使
用 JdbcTemplate 的 update() 方法将 Ingredient 对象保存到数据库中。
虽然这是第一个很好的例子，但是它可能有点太简单了。保存数据一般都会比 JdbcIngredientRepository 所做的
更复杂。
在我们的设计中，TacoOrder 和 Taco 是聚合关系，其中 TacoOrder 是聚合根。换句话说，Taco 对象不存在于
TacoOrder 的上下文之外。所以，现在，我们只需要定义一个 Repository 来持久化 TacoOrder 对象，进而持久
化 Taco 对象。这样的 Repository 在OrderRepository 接口中定义，如下所示：
package tacos.data;
import java.util.Optional;
import tacos.TacoOrder;
public interface OrderRepository {
TacoOrder save(TacoOrder order);
}
看起来很简单，对吧？没那么容易的。当保存 TacoOrder 时，还必须保存和它一起的那些 Taco。在保存 Taco
对象时，还需要保存一个对象，表示 Taco 和构成玉米卷的每个 Ingredient 之间的关联。IngredientRef 类定义
了 Taco 和 Ingredient 之间的关系：
package tacos;
import lombok.Data;
@Data
public class IngredientRef {
private final String ingredient;
}
这个 save() 方法，比之前创建的用于保存 Ingredient 对象的方法要更有趣。
save() 方法需要做的另一件事是确定保存后分配给的 ID。根据建表的 Schema，Taco_Order 表上的 id 属性是
identity，这意味着数据库将自动确定其值。但是如果数据库为您确定的值，您需要知道该值是什么，以便在
save() 方法返回的 TacoOrder 对象中返回。幸运的是，Spring 提供了一个 GeneratedKeyHolder 类可以帮助您
实现这一点。但它涉及到使用 Prepared Statement，如下面的 save() 方法所示：

--- 第 88 页 ---
88
package tacos.data;
import java.sql.Types;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import org.springframework.asm.Type;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.PreparedStatementCreatorFactory;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tacos.IngredientRef;
import tacos.Taco;
import tacos.TacoOrder;
@Repository
public class JdbcOrderRepository implements OrderRepository {
private JdbcOperations jdbcOperations;
public JdbcOrderRepository(JdbcOperations jdbcOperations) {
this.jdbcOperations = jdbcOperations;
}
@Override
@Transactional
public TacoOrder save(TacoOrder order) {
PreparedStatementCreatorFactory pscf =
new PreparedStatementCreatorFactory(
"insert into Taco_Order "
+ "(delivery_name, delivery_street, delivery_city, "
+ "delivery_state, delivery_zip, cc_number, "
+ "cc_expiration, cc_cvv, placed_at) "
+ "values (?,?,?,?,?,?,?,?,?)",
Types.VARCHAR, Types.VARCHAR, Types.VARCHAR,
Types.VARCHAR, Types.VARCHAR, Types.VARCHAR,
Types.VARCHAR, Types.VARCHAR, Types.TIMESTAMP
);
pscf.setReturnGeneratedKeys(true);
order.setPlacedAt(new Date());
PreparedStatementCreator psc =
pscf.newPreparedStatementCreator(
Arrays.asList(
order.getDeliveryName(),
order.getDeliveryStreet(),
order.getDeliveryCity(),
order.getDeliveryState(),
order.getDeliveryZip(),
order.getCcNumber(),
order.getCcExpiration(),
order.getCcCVV(),
order.getPlacedAt()));
GeneratedKeyHolder keyHolder = new GeneratedKeyHolder();
jdbcOperations.update(psc, keyHolder);
long orderId = keyHolder.getKey().longValue();
order.setId(orderId);
List<Taco> tacos = order.getTacos();

--- 第 89 页 ---
89
int i=0;
for (Taco taco : tacos) {
saveTaco(orderId, i++, taco);
}
return order;
}
}
在这个方法中似乎有很多东西。但是如果您把 save() 分解，就会有发现只有少数几个重要步骤。首先，创建
PreparedStatementCreatorFactory。它描述了插入查询以及输入字段的类型。因为您会稍后需要获取保存后的
订单 ID，您还需要调用 setReturnGeneratedKeys(true) 。
定义 PreparedStatementCreatorFactory 后，可以使用它创建 PreparedStatementCreator，从将要创建的
TacoOrder 对象传入值进行持久化。提供给 PreparedStatementCreator 的最后一个字段是订单发出的日期。您
还需要对 TacoOrder 对象本身进行设置，以便 TacoOrder 将提供这些信息。
现在您有一个 PreparedStatementCreator，可以通过调用 JdbcTemplate上的 update() 方法实际保存数据了。
传入 PreparedStatementCreator 和 GeneratedKeyHolder。订单数据保存后，GeneratedKeyHolder 将包含由数
据库生成的 id，并应复制到TacoOrder 对象的 id 属性中。
此时，订单已保存，但还需要保存关联的 Taco 对象。您可以为订单中的每个玉米卷调用 saveTaco() 。
saveTaco() 方法与 save() 方法非常相似，如下所示：
private long saveTaco(Long orderId, int orderKey, Taco taco) {
taco.setCreatedAt(new Date());
PreparedStatementCreatorFactory pscf =
new PreparedStatementCreatorFactory(
"insert into Taco "
+ "(name, created_at, taco_order, taco_order_key) "
+ "values (?, ?, ?, ?)",
Types.VARCHAR, Types.TIMESTAMP, Type.LONG, Type.LONG
);
pscf.setReturnGeneratedKeys(true);
PreparedStatementCreator psc =
pscf.newPreparedStatementCreator(
Arrays.asList(
taco.getName(),
taco.getCreatedAt(),
orderId,
orderKey));
GeneratedKeyHolder keyHolder = new GeneratedKeyHolder();
jdbcOperations.update(psc, keyHolder);
long tacoId = keyHolder.getKey().longValue();
taco.setId(tacoId);
saveIngredientRefs(tacoId, taco.getIngredients());
return tacoId;
}
一步一步地， saveTaco() 的结构与 save() 类似，只不过是保存 Taco 数据而不是 TacoOrder 数据。最后，它调
用 saveingredientfs() 在 Ingredient_Ref 表插入一行，用于将 Taco 行链接到 Ingredient 行。这个
saveingredientfs() 方法如下所示：

--- 第 90 页 ---
90
private void saveIngredientRefs(
long tacoId, List<IngredientRef> ingredientRefs) {
int key = 0;
for (IngredientRef ingredientRef : ingredientRefs) {
jdbcOperations.update(
"insert into Ingredient_Ref (ingredient, taco, taco_key) "
+ "values (?, ?, ?)",
ingredientRef.getIngredient(), tacoId, key++);
}
}
谢天谢地， saveIngredientRefs() 方法要简单得多。它循环列表中的 Ingredient 对象，将每个对象保存到
Ingredient_Ref 表中。它还有一个局部变量，被用作一个索引，以确保配料的顺序保持不变。
OrderRepository 剩下要做的就是，将其注入 OrderController，并在需要时使用它保存订单。下面的列表显示注
入了 repository 所需的更改。
程序清单 3.11 注入并使用 OrderRepository
package tacos.web;
import javax.validation.Valid;
import org.springframework.stereotype.Controller;
import org.springframework.validation.Errors;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.SessionAttributes;
import org.springframework.web.bind.support.SessionStatus;
import tacos.TacoOrder;
import tacos.data.OrderRepository;
@Controller
@RequestMapping("/orders")
@SessionAttributes("tacoOrder")
public class OrderController {
private OrderRepository orderRepo;
public OrderController(OrderRepository orderRepo) {
this.orderRepo = orderRepo;
}
// ...
@PostMapping
public String processOrder(@Valid TacoOrder order, Errors errors, SessionStatus sessionStatus) {
if (errors.hasErrors()) {
return "orderForm";
}
orderRepo.save(order);
sessionStatus.setComplete();
return "redirect:/";
}
}
如您所见，构造函数将 OrderRepository 作为参数，将其分配给实例变量，并在 processOrder() 方法中使用。
说到 processOrder() 方法，它已更改调用 OrderRepository 的 save() 方法，而不是记录 TacoOrder 对象。

--- 第 91 页 ---
91
Spring 的 JdbcTemplate 使操作关系数据库比使用纯 JDBC 要简单的多。但即使使用JdbcTemplate，一些持久
化任务仍然具有挑战性。尤其是在聚合中持久化嵌套对象时。要是有办法解决这个问题就好了。
让我们看一看 Spring Data JDBC，它使得使用 JDBC 变得非常简单——即使是持久化聚合对象时。

--- 第 92 页 ---
92
3.2 使用 Spring Data JDBC
Spring Data 项目是一个相当大的一揽子项目，由几个子项目组成，其中大多数是聚焦在对各种不同数据库类型
进行持久化。一些最流行的 Spring Data 项目包括：
Spring Data JDBC —— 针对关系数据库的 JDBC 持久化
Spring Data JPA —— 针对关系数据库的 JPA 持久化
Spring Data MongoDB —— Mongo 文档数据库的持久化
Spring Data Neo4j —— 持久化到 Neo4j 图形数据库
Spring Data Redis —— 持久化到 Redis 键值存储数据库
Spring Data Cassandra —— 持久化到 Cassandra 列存储数据库
Spring Data 为所有这些项目提供的最有趣、最有用的特性之一是，基于 Repository 规范接口自动创建
Repository 的能力。因此，Spring Data 项目的持久化几乎没有持久化逻辑，只涉及编写一个或多个 Repository
接口。
让我们看看如何将 Spring Data JDBC 应用到我们的项目中，以简化 JDBC 的数据持久化。首先，需要将
Spring Data JDBC 添加到项目构建中。

--- 第 93 页 ---
93
3.2.1 添加 Spring Data JDBC 到项目构建中
Spring Data JDBC 有 Spring Boot 的 starter 依赖项。可添加到项目的 pom.xml 文件中，如下所示：
<dependency>
<groupId>org.springframework.boot</groupId>
<artifactId>spring-boot-starter-data-jdbc</artifactId>
</dependency>
您将不再需要提供 JdbcTemplate 的 JDBC starter，因此您可以删除如下依赖：
<dependency>
<groupId>org.springframework.boot</groupId>
<artifactId>spring-boot-starter-jdbc</artifactId>
</dependency>
但是，您仍然需要一个数据库，所以不要删除 H2 依赖项。

--- 第 94 页 ---
94
3.2.2 定义 Repository 接口
幸运的是，我们已经创建了 IngredientRepository 和 OrderRepository，定义存储库的工作已经完成。但我们需
要对它们做一点微小的改变，以使它们与 Spring Data JDBC 一起工作。
Spring Data 将在运行时，自动为我们的存储库接口生成实现类。但它只会对扩展自 Spring Data 几个
Repository 接口的类执行此操作。所以，我们的存储库接口需要扩展自 Repository，以便 Spring Data 知道要自
动创建实现类。例如，以下是您可能编写的 IngredientRepository，扩展自 Repository ：
package tacos.data;
import java.util.Optional;
import org.springframework.data.repository.Repository;
import tacos.Ingredient;
public interface IngredientRepository
extends Repository<Ingredient, String> {
Iterable<Ingredient> findAll();
Optional<Ingredient> findById(String id);
Ingredient save(Ingredient ingredient);
}
如您所见，存储库接口是参数化的。第一个参数是要由该存储库持久化的对象 —— 在本例中为 Ingredient。第
二个参数是持久化对象的 ID 字段的类型。对于 Ingredient，是 String。
通过扩展 Repository，如上所示的 IngredientRepository 能够正常工作。Spring Data 还提供 Crudepository 作
为常见操作的基本接口，包括三个我们在 IngredientRepository 中定义的方法。因此，我们可以不扩展
Repository，而通常更方便的扩展 CrudRepository，如下所示：
package tacos.data;
import org.springframework.data.repository.CrudRepository;
import tacos.Ingredient;
public interface IngredientRepository
extends CrudRepository<Ingredient, String> {
}
同样，我们的 OrderRepository 可以像这样扩展 CrudRepository：
package tacos.data;
import org.springframework.data.repository.CrudRepository;
import tacos.TacoOrder;
public interface OrderRepository
extends CrudRepository<TacoOrder, Long> {
}
在这两种情况下，因为 CrudRepository 已经定义了所需的方法，所以没有必要在 IngredientRepository 和
OrderRepository 接口中显式定义它们。

--- 第 95 页 ---
95
现在您有了两个存储库。您可能认为您需要写这两个存储库的实现，包括 Crudepository 中定义的十几个方法。
但 Spring Data 给您带来了好消息，根本不需要编写实现类！不管什么时候，只要应用程序启动了，Spring
Data 将自动生成一个实现类。这意味着存储库从一开始就已经可以使用了。只需将它们注入控制器，您的工作
就完成了。
此外，因为 Spring Data 在运行时将自动创建这些接口的实现，您不再需要显式实现 JdbcIngredientRepository
和 JdbcOrderRepository。您可以删除这两个类，根本不必有任何担心！

--- 第 96 页 ---
96
3.2.3 为持久化注解领域实体
我们唯一需要做的另一件事是为领域实体添加注解，这样 Spring Data JDBC 就可以知道如何进行持久化了。一
般来说，这意味着使用 @Id 指定标识属性 —— 这样 Spring Data 将知道哪个字段表示对象的标识 —— 并且可
以选择在类上使用 @Table 注解。例如，TacoOrder 类用了 @Table 和 @Id 注解，如下所示：
清单 3.15 为持久化准备 Taco 类。
package tacos;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import javax.validation.constraints.Digits;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import org.hibernate.validator.constraints.CreditCardNumber;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
import lombok.Data;
@Data
@Table
public class TacoOrder implements Serializable {
private static final long serialVersionUID = 1L;
@Id
private Long id;
// ...
}
注解 @Table 是可选的。默认情况下，对象将映射到一个数据库表，表名是对象的类名称。在本例中，
TacoOrder 映射到一个名为“TacoOrder”的表上。如果这对您来说是合适的，您就完全不用添加 @Table 注解，
或者即使使用也不添加任何参数。但如果希望将对象映射到其他的表名上，则可以使用 @Table 参数来指定表名
称，如下所示：
@Table("Taco_Cloud_Order")
public class TacoOrder {
...
}
如图所示，TacoOrder 将映射到一个名为“Taco_Cloud_Order”的表上。至于 @Id 注解，它将 Id 属性指定为
TacoOrder 的标识。TacoOrder 中的所有其他属性，将根据其属性名称自动映射到列上。例如，deliveryName
属性将自动映射到名为“delivery_name”的列上。如果要显式定义列名，您可以使用 @Column 注解的参数进行指
定：
@Column("customer_name")
@NotBlank(message="Delivery name is required")
private String deliveryName;

--- 第 97 页 ---
97
您还需要将 @Table 和 @Id 注解应用于其他领域实体类。如 Ingredient 类：
清单 3.16 为持久化准备 Ingredient 类。
package tacos;
import org.springframework.data.annotation.Id;
import org.springframework.data.domain.Persistable;
import org.springframework.data.relational.core.mapping.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
@Data
@Table
@AllArgsConstructor
@NoArgsConstructor(access=AccessLevel.PRIVATE, force=true)
public class Ingredient implements Persistable<String> {
@Id
private String id;
// ...
}
还有 Taco 类：
清单 3.17 为持久化准备 Taco 类。
package tacos;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
import lombok.Data;
@Data
@Table
public class Taco {
@Id
private Long id;
// ...
}
至于 IngredientRef，它将自动映射到名为“Ingredient_Ref”的表上，这非常适合我们的应用。如果需要，可以使
用 @Table 注解对其进行调整，但这完全不必要。“"Ingredient_Ref”表没有标识列，因此无需在 IngredientRef
中使用 @Id 注解。

--- 第 98 页 ---
98
有了这些小小的改变，更不用说完全移除的 JdbcIngredientRepository 和 JdbcOrderRepository 类，您现在进行
持久化的代码要少很多了。即使如此，它仍然完成了使用 JdbcTemplate 的存储库所做的一切。事实上，还可以
做更多的事情，因为这两个存储库接口扩展自 CrudRepository，里边提供了十几种用于创建、读取、更新和删
除对象的方法。