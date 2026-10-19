<!-- startPage: 99 endPage: 118 -->
--- 第 99 页 ---
99
3.2.4 使用 CommandLineRunner 预加载数据
使用 JdbcTemplate 时，我们在应用程序启动时使用 data.sql 预加载了 Ingredient 数据，在创建数据源 bean 时
对数据库执行插入操作。同样的方法也适用于 Spring Data JDBC。事实上，它对任何关系型数据库的持久化都
有效。但是让我们看看另一种在启动时填充数据库的更灵活的方法。
Spring Boot 为应用程序启动时执行一些逻辑，提供了两个有用的接口：CommandLineRunner 和
ApplicationRunner。这两个函数式接口非常相似。都需要实现 run() 方法。当应用程序启动时，应用程序上下
文中实现了 CommandLineRunner 或 ApplicationRunner 接口的任何 bean，将在应用程序上下文和所有 bean
生成之后，在其他任何事情发生之前，调用它们的 run() 方法。这为我们提供了一个方便的地方，以加载预置
数据到数据库中。
因为 CommandLineRunner 和 ApplicationRunner 都是函数式接口，可以很方便的使用 @Bean 注解，在配置类
中声明为 Bean，且返回一个 lambda 函数。例如，数据加载 CommandLineRunner bean 的例子：
@Bean
public CommandLineRunner dataLoader(IngredientRepository repo) {
return args -> {
repo.save(new Ingredient("FLTO", "Flour Tortilla", Type.WRAP));
repo.save(new Ingredient("COTO", "Corn Tortilla", Type.WRAP));
repo.save(new Ingredient("GRBF", "Ground Beef", Type.PROTEIN));
repo.save(new Ingredient("CARN", "Carnitas", Type.PROTEIN));
repo.save(new Ingredient("TMTO", "Diced Tomatoes", Type.VEGGIES));
repo.save(new Ingredient("LETC", "Lettuce", Type.VEGGIES));
repo.save(new Ingredient("CHED", "Cheddar", Type.CHEESE));
repo.save(new Ingredient("JACK", "Monterrey Jack", Type.CHEESE));
repo.save(new Ingredient("SLSA", "Salsa", Type.SAUCE));
repo.save(new Ingredient("SRCR", "Sour Cream", Type.SAUCE));
};
}
`
这里，IngredientRepository 被注入 bean 方法中，并在 lambda 中创建 Ingredient 对象。CommandLineRunner
的 run() 方法接受单个参数，该参数是字符串变量，其中包含所有运行应用的命令行参数。我们不需要这些配
料对象加载到数据库中，因此 args 参数可以忽略。
或者，我们可以将数据加载器 bean 定义为 ApplicationRunner 的 lambda 实现，如下所示：
@Bean
public ApplicationRunner dataLoader(IngredientRepository repo) {
return args -> {
repo.save(new Ingredient("FLTO", "Flour Tortilla", Type.WRAP));
repo.save(new Ingredient("COTO", "Corn Tortilla", Type.WRAP));
repo.save(new Ingredient("GRBF", "Ground Beef", Type.PROTEIN));
repo.save(new Ingredient("CARN", "Carnitas", Type.PROTEIN));
repo.save(new Ingredient("TMTO", "Diced Tomatoes", Type.VEGGIES));
repo.save(new Ingredient("LETC", "Lettuce", Type.VEGGIES));
repo.save(new Ingredient("CHED", "Cheddar", Type.CHEESE));
repo.save(new Ingredient("JACK", "Monterrey Jack", Type.CHEESE));
repo.save(new Ingredient("SLSA", "Salsa", Type.SAUCE));
repo.save(new Ingredient("SRCR", "Sour Cream", Type.SAUCE));
};
}

--- 第 100 页 ---
100
CommandLineRunner 和 ApplicationRunner 之间的关键区别在于，传递给 run() 方法的参数。
CommandLineRunner 接受字符串变量，该字符串命令行上传递的参数的原始表示形式。但是
ApplicationRunner 接受 ApplicationArguments 参数，作为命令行解析组件，该参数提供了访问参数的一些方
法。
例如，假设我们希望应用程序接受命令行中所带的参数，比如“--version 1.2.3”，需要在我们的加载器 bean 中使
用这个参数。如果使用 CommandLineRunner，我们需要在数组中搜索“-version”，然后提取紧接其后的数组中
的值。但是使用 ApplicationRunner，我们可以查询定的 ApplicationArguments，直接使用“--version”参数。如
下所示：
public ApplicationRunner dataLoader(IngredientRepository repo) {
return args -> {
List<String> version = args.getOptionValues("version");
...
};
}
getOptionValues() 方法返回一个 List<String> ，以允许选项参数可以多次指定。
但是，无论是 CommandLineRunner 还是 ApplicationRunner，我们都不需要命令行参数加载数据。因此，args
参数在我们的数据加载器 bean 中被忽略。
使用 CommandLineRunner 或 ApplicationRunner 进行初始数据加载的好处，是他们使用存储库来创建对象，
而不是使用 SQL 脚本。这意味着它们对关系数据库或非关系数据库同样有效。在下一章中，当我们看到如何使
用 Spring Data 持久化到非关系数据库，这就会显得非常方便。
但在此之前，让我们先看一看另一个 Spring Data 持久化关系数据库数据的项目：Spring Data JPA。

--- 第 101 页 ---
101
3.3 使用 Spring Data JPA 持久化数据
虽然 Spring Data JDBC 可以轻松地持久化数据，但 Java Persistence API（JPA）也是在关系数据库中处理数
据的另一个常用选项。Spring Data JPA 提供了一个类似 JDBC 的 JPA 方式来持久化数据。
为了了解 Spring Data 是如何工作的，需要将本章前面介绍的基于 jdbc 的存储库替换为 Spring Data JPA 创建
的存储库。但是首先，需要将 Spring Data JPA 添加到项目构建中。

--- 第 102 页 ---
102
3.3.1 添加 Spring Data JPA 到工程中
添加了 JPA starter 的 Spring Boot 应用程序就可以使用 Spring Data JPA。这个 starter 依赖不仅带来了 Spring
Data JPA，还隐含添加了 Hibernate 作为 JPA 的实现：
<dependency>
<groupId>org.springframework.boot</groupId>
<artifactId>spring-boot-starter-data-jpa</artifactId>
</dependency>
如果想使用不同的 JPA 实现，那么至少需要排除 Hibernate 依赖，并包含所选择的 JPA 库。例如，要使用
EclipseLink 而不是 Hibernate，需要按如下方式更改构建：
<dependency>
<groupId>org.springframework.boot</groupId>
<artifactId>spring-boot-starter-data-jpa</artifactId>
<exclusions>
<exclusion>
<groupId>org.hibernate</groupId>
<artifactId>hibernate-core</artifactId>
</exclusion>
</exclusions>
</dependency>
<dependency>
<groupId>org.eclipse.persistence</groupId>
<artifactId>org.eclipse.persistence.jpa</artifactId>
<version>2.7.6</version>
</dependency>
请注意，根据对 JPA 实现的选择，可能需要进行其他更改。详细信息请参阅选择的 JPA 实现的文档。现在，让
我们重新查看领域对象并对它们进行注解，以实现 JPA 持久化。

--- 第 103 页 ---
103
3.3.2 注解领域实体
正如您已经在 Spring Data JDBC 中看到的，Sprin gData 在运行时做了一些惊人的事情，自动创建存储库实
现。但不幸的是，这对领域对象添加 JPA 注解并没有多大帮助。您需要打开 Ingredient、Taco 和 TacoOrder
类，并添加一些注解。首先是 Ingredient 类：
程序清单 3.18 为 JPA 持久化注解 Ingredient 类
package tacos;
import javax.persistence.Entity;
import javax.persistence.Id;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
@Data
@Entity
@AllArgsConstructor
@NoArgsConstructor(access=AccessLevel.PRIVATE, force=true)
public class Ingredient {
@Id
private String id;
private String name;
private Type type;
public static enum Type {
WRAP, PROTEIN, VEGGIES, CHEESE, SAUCE
}
}
为了将其声明为 JPA 实体，Ingredient 类必须使用 @Entity 注解。它的 id 属性必须使用 @Id 进行注解，以便
将其指定为惟一标识数据库中实体的属性。注意，这是来自 javax.persistence 包的 @Id 注解，而不是
org.springframework.data.annotation 包中的 @Id 注解。
还要注意，我们不再需要 @Table 注解，也不需要实现 Persistable。虽然我们仍然可以在这里使用 @Table 注
解，但在使用 JPA 时是不需要这么做的，表名默认设置为类的名称（本例中为“"Ingredient”）。至于
Persistable，它只需要在使用 Spring Data JDBC 时，来确定是否要创建新实体还是更新现有实体。JPA 会自动
测别出来。
除了特定于 JPA 的注解之外，还在类级别上添加了 @NoArgsConstructor 注解。JPA 要求实体有一个无参构造函
数，所以 Lombok 的 @NoArgsConstructor 实现了这一点。但是要是不想使用它，可以通过将 access 属性设置为
AccessLevel.PRIVATE 来将其设置为私有。因为必须设置 final 属性，所以还要将 force 属性设置为 true，这将
导致 Lombok 生成的构造函数，依据属性类型的不同会将它们设置为 null、0 或者 false。
您还将添加一个 @AllArgsConstructor ，以便于使用所有属性初始化值创建 Ingredient 对象。
还添加了一个 @RequiredArgsConstructor 。 @Data 隐式地添加了一个必需的有参构造函数，但是当使用
@NoArgsConstructor 时，该构造函数将被删除。显式的 @RequiredArgsConstructor 确保除了私有无参数构造函数
外，仍然有一个必需有参构造函数。
现在让我们转到 Taco 类，看看如何将其注解为 JPA 实体。
程序清单 3.19 把 Taco 注解为实体

--- 第 104 页 ---
104
package tacos;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.ManyToMany;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
import lombok.Data;
@Data
@Entity
public class Taco {
@Id
@GeneratedValue(strategy = GenerationType.AUTO)
private Long id;
@NotNull
@Size(min=5, message="Name must be at least 5 characters long")
private String name;
private Date createdAt = new Date();
@Size(min=1, message="You must choose at least 1 ingredient")
@ManyToMany()
private List<Ingredient> ingredients = new ArrayList<>();
public void addIngredient(Ingredient ingredient) {
this.ingredients.add(ingredient);
}
}
与 Ingredient 一样，Taco 类现在使用 @Entity 注解，其 id 属性使用 @Id 注解。因为依赖于数据库自动生成 id
值，所以还使用 @GeneratedValue 注解 id 属性，指定自动生成策略。
要声明 Taco 及其相关 Ingredient 列表之间的关系，可以使用 @ManyToMany 注解 ingredient 属性。一个 Taco 可
以有很多 Ingredient，一个 Ingredient 可以是很多 Taco 的一部分。
最后，让我们将 Order 对象注解为一个实体。下一个程序清单展示了新的 Order 类。
程序清单 3.20 把 Order 注解为 JPA 实体

--- 第 105 页 ---
105
package tacos;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import javax.persistence.CascadeType;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.OneToMany;
import javax.validation.constraints.Digits;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import org.hibernate.validator.constraints.CreditCardNumber;
import lombok.Data;
@Data
@Entity
public class TacoOrder implements Serializable {
private static final long serialVersionUID = 1L;
@Id
@GeneratedValue(strategy = GenerationType.AUTO)
private Long id;
private Date placedAt = new Date();
...
@OneToMany(cascade = CascadeType.ALL)
private List<Taco> tacos = new ArrayList<>();
public void addTaco(Taco taco) {
this.tacos.add(taco);
}
}
如您所见，对 Order 的更改与对 Taco 的更改非常相似。值得注意的是，与 Taco 对象列表的关系用的是
@OneToMany 注解，表示玉米卷都是针对这一订单的。此外，级联参数设置为 CascadeType.ALL，这样，如果订
单被删除，其相关的玉米卷也将被删除。

--- 第 106 页 ---
106
3.3.3 声明 JPA Repository
当您创建 JdbcTemplate 版本的存储库时，您明确声明了希望 repository 提供的方法。当使用 Spring Data
JDBC 时，不用再明确实现类，而是扩展 CrudRepository 接口。事实上，CrudRepository 在 Spring Data JPA
下也可以很好的工作。例如，下面是一个新的 IngredientRepository 接口：
package tacos.data;
import org.springframework.data.repository.CrudRepository;
import tacos.Ingredient;
public interface IngredientRepository
extends CrudRepository<Ingredient, String> {
}
事实上，我们将用于 Spring Data JPA 的 IngredientRepository 接口，与我们定义的用于 Spring Data JDBC 的
那个完全一样。CrudRepository 接口通常可以在 Spring Data 的许多项目中使用，而不用考虑底层的持久化机
制。类似地，您可以为 Spring Data JPA定义 OrderRepository，这与为 Spring Data JDBC 定义的那个是一样
的：
package tacos.data;
import org.springframework.data.repository.CrudRepository;
import tacos.TacoOrder;
public interface OrderRepository
extends CrudRepository<TacoOrder, Long> {
}
CrudRepository 提供的方法非常适合实体的能用持久化需求。但是如果有一些特殊的需求呢？让我们看看如何
自定义 repository 来执行特有的查询。

--- 第 107 页 ---
107
3.3.4 自定义 Repository
想象一下，除了 CrudRepository 提供的基本 CRUD 操作之外，还需要获取投递给指定邮政编码的所有订单。事
实证明，通过在 OrderRepository 中添加以下方法声明可以很容易地解决这个问题：
List<TacoOrder> findByDeliveryZip(String deliveryZip);
在生成 repository 实现时，Spring Data 检查存储库接口中的任何方法，解析方法名称，并尝试在持久化对象的
上下文中理解方法的用途（在本例中是 TacoOrder）。本质上，Spring Data 定义了一种小型的领域特定语言
（DSL），其中持久化细节用 repository 中的方法签名表示。
Spring Data 知道这个方法是用来查找订单的，因为已经用 TacoOrder 参数化了 CrudRepository。方法名
findByDeliveryZip() 表明，该方法应该通过将其 deliveryZip 属性与作为参数，传递给匹配的方法来查找所有订
单实体。
findByDeliveryZip() 方法非常简单，但是 Spring Data 也可以处理更有趣的方法名。repository 的方法由一个动
词、一个可选的主语、单词 by 和一个谓词组成。在 findByDeliveryZip() 中，动词是 find，谓词是
DeliveryZip，主语没有指定，暗示是一个 TacoOrder。
让我们考虑另一个更复杂的例子。假设需要查询在给定日期范围内投递给指定邮政编码的所有订单。在这种情
况下，当添加到 OrderRepository 时，下面的方法可能会被证明是有用的：
List<TacoOrder> readOrdersByDeliveryZipAndPlacedAtBetween(
String deliveryZip, Date startDate, Date endDate);
图 3.2 说明了在生成 respository 实现时，Spring Data 如何解析和理解
readOrdersByDeliveryZipAndPlacedAtBetween() 方法。可以看到， readOrdersByDeliveryZipAndPlacedAtBetween() 中的动
词是 read。Spring Data 还将 find、read 和 get 理解为获取一个或多个实体的同义词。另外，如果只希望方法返
回一个带有匹配实体计数的 int，也可以使用 count 作为动词。
图 3.2 Spring Data 解析 repository 方法特征来确定如何运行查询语句
尽管该方法的主语是可选的，但在这里它表示 Orders。Spring Data 会忽略主题中的大多数单词，因此可以将方
法命名为 readPuppiesBy… 它仍然可以找到 TacoOrder 实体，因为这是 CrudRepository 参数化的类型。

--- 第 108 页 ---
108
谓词跟在方法名中的 By 后面，是方法签名中最有趣的部分。在本例中，谓词引用两个 TacoOrder 属性：
deliveryZip 和 placedAt。deliveryZip 属性必须与传递给方法的第一个参数的值一致。Between 关键字表示
deliveryZip 的值必须位于传入方法最后两个参数的值之间。
除了一个隐式的 Equals 操作和 Between 操作外，Spring Data 方法签名还可以包括以下任何操作：
IsAfter, After, IsGreaterThan, GreaterThan
IsGreaterThanEqual, GreaterThanEqual
IsBefore, Before, IsLessThan, LessThan
IsLessThanEqual, LessThanEqual
IsBetween, Between
IsNull, Null
IsNotNull, NotNull
IsIn, In
IsNotIn, NotIn
IsStartingWith, StartingWith, StartsWith
IsEndingWith, EndingWith, EndsWith
IsContaining, Containing, Contains
IsLike, Like
IsNotLike, NotLike
IsTrue, True
IsFalse, False
Is, Equals
IsNot, Not
IgnoringCase, IgnoresCase
作为 IgnoringCase 和 IgnoresCase 的替代方法，可以在方法上放置 AllIgnoringCase 或 AllIgnoresCase 来忽略
所有 String 比较的大小写。例如，考虑以下方法：
List<TacoOrder> findByDeliveryToAndDeliveryCityAllIgnoresCase(
String deliveryTo, String deliveryCity);
最后，还可以将 OrderBy 放在方法名的末尾，以便根据指定的列对结果进行排序。例如，通过 deliveryTo 属性
来订购：
List<TacoOrder> findByDeliveryCityOrderByDeliveryTo(String city);
虽然命名约定对于相对简单的查询很有用，但是对于更复杂的查询，不需要太多的想象就可以看出方法名称可
能会失控。在这种情况下，可以随意将方法命名为任何想要的名称，并使用 @Query 对其进行注解，以显式地指
定调用方法时要执行的查询，如下例所示：
@Query("Order o where o.deliveryCity='Seattle'")
List<TacoOrder> readOrdersDeliveredInSeattle();
在这个 @Query 的简单用法中，请求在西雅图交付的所有订单。但是也可以使用 @Query 来执行几乎任何想要的
查询，即使通过遵循命名约定来实现查询很困难或不可能。
自定义查询方法也适用于 Spring Data JDBC，但有两个关键区别：
所有自定义查询方法都需要 @query 。这是因为，与 JPA 不同，没有映射元数据以帮助 Spring Data JDBC
关联查询与方法称。

--- 第 109 页 ---
109
@Query 中指定的所有查询必须是 SQL 查询，而不是 JPA 查询。
在下一章中，我们将扩展 Spring Data 在非关系数据库中使用。当我们这样做时，您将看到自定义查询方法的工
作方式非常类似，尽管查询 @Query 中使用的语言将特定于底层数据库。

--- 第 110 页 ---
110
3.4 总结
JdbcTemplate 大大简化了 JDBC 的工作。
当需要知道数据库生成的 id 时，可以同时使用 PreparedStatementCreator 和 KeyHolder。
Spring Data JPA 使得 JPA 持久化就像编写存储库接口一样简单。

--- 第 111 页 ---
111
第 4 章处理非关系型数据
本章内容：
将数据持久化到 Cassandra
Cassandra 中的数据建模
在 MongoDB 中使用文档数据
丰富多彩的生活才乐趣横生。
您可能有最喜欢冰淇淋的味道。您最喜欢的某种口味，通常是因为这比其他更能满足您的欲望。但是大多数
人，尽管有自己喜欢的口味，还会不时尝试其他不同的口味。
数据库就像冰淇淋。几十年来，关系型数据库一直是用户最喜欢的类型。但是现在比以往任何时候都有更多的
选择。所谓的“NoSQL”数据库提供了不同的概念和结构。尽管选择可能仍然在某种程度上取决于您的喜爱好，但
有些数据库更适合于保存其他类型的数据。
幸运的是，Spring Data 支持了许多 NoSQL 数据库，包括 MongoDB、Cassandra、Couchbase、Neo4j、
Redis 等等。而且幸运的是， 无论选择哪个数据库，编程模型几乎是相同的。
本章没有足够的篇幅涵盖 Spring Data 支持的所有数据库类型。但为了让您了解 Spring Data 的其他“风味”，我
们将研究两种流行的 NoSQL 数据库，Cassandra 和 MongoDB，并了解如何创建 Repository 进行数据持久
化。让我们先看看如何使用 Spring Data 创建Cassandra Repository。

--- 第 112 页 ---
112
4.1 使用 Cassandra Repository
Cassandra 是一个分布式、高性能、高可用、最终一致、分区行存储的 NoSQL 数据库。
这些词描述了 Cassandra 的主要特点，每一个都准确的说明了 Cassandra 的一种能力。简单地说，Cassandra
以数据行的方式处理数据，这些数据被写入到表中，这些表分区后，存储到多个节点上。没有一个节点存储所
有数据，且任何给定的行，都是以跨多个节点的多个复本存储的，这种方式就消除了单点故障。
Spring Data Cassandra 为 Cassandra 提供了自动 Repository 支持。这和为关系数据库提供支持的 Spring Data
JPA 有很大不同。此外，Spring Data Cassandra 提供了新的注解，用于将应用程序实体类型映射到后台数据库
结构上。
在我们进一步探索 Cassandra 之前，必须始终牢记一点。就是尽管 Cassandra 与 Oracle、SQL Server 等关系
型数据库有许多相似的概念，但 Cassandra 不是一个关系型数据库。 Cassandra 在很多方面与关系型数据库不
同，我将试图解释 Cassandra 的特质，以及通过 Spring Data 使用它。我鼓励您阅读 Cassandra
(http://cassandra.apache.org/doc/latest/) 的官方文档，以彻底全面的了解为什么 Cassandra 如此大受欢迎。
让我们从在 Taco Cloud 项目中启用 Spring Data Cassandra 开始。

--- 第 113 页 ---
113
4.1.1 启用 Spring Data Cassandra
要开始使用 Spring Data Cassandra，您需要为 Spring Boot 添加 Spring Data Cassandra 依赖。实际上有两个
独立的 Spring Data Cassandra 依赖项可供选择：一个用于响应式数据持久化，另一个用于标准、非响应式持久
化。
我们将在第 15 章后面讨论更多关于编写响应式 Repository 的内容。现在，我们使用非响应式 starter 依赖项：
<dependency>
<groupId>org.springframework.boot</groupId>
<artifactId>spring-boot-starter-data-cassandra</artifactId>
</dependency>
通过勾选 Cassandra 复选框，也可以在 Initializr 中获得此依赖项。
现在，重要的是理解这种依赖关系是代替了 Spring Data JPA 依赖项的。因为我们不是将 Taco Cloud 数据使用
JPA 持久化到关系数据库，而是使用 Spring Data 将数据持久化到 Cassandra 数据库。因此，您要移除 Spring
Data JPA 以及任何关系数据库的依赖项（例如 JDBC 驱动程序或 H2 依赖项）。
Spring Data Cassandra stater 的依赖会带来一些下层依赖，其中主要包括 Spring Data Cassandra 的包。有了
这些包位于运行时类路径中，自动配置会触发 Cassandra Repository 的创建。这意味着可以用很少的显式配置
来编写 Cassandra Repository。
Cassandra 作为多节点的集群运行，这些节点共同充当一个完整的数据库系统。如果您没有 Cassandra 集群可
以使用，则可以为其启动单节点集群，为开发目的使用 Docker 创建：
$ docker network create cassandra-net
$ docker run --name my-cassandra \
--network cassandra-net \
-p 9042:9042 \
-d cassandra:latest
这将启动单节点集群，并使用端口（9042），供您的应用程序访问。
不过，您也需要提供一些必要配置。至少，您需要配置一个键空间的名称， Repository 将在该空间中进行操
作。为此，首先需要创建这样一个键空间。
注意在 Cassandra 中，键空间是 Cassandra 节点中的一组表。它大致类似于关系数据库中的一个库。
尽管可以配置 Spring Data Cassandra 自动地创建键空间，但手动创建通常要容易得多（或者使用现有键空
间）。使用 Cassandra CQL（Cassandra Query Language） ，您可以为 Taco Cloud 应用程序创建键空间。您可以使用
Docker 启动 CQL shell，如下所示：：
$ docker run -it --network cassandra-net --rm cassandra cqlsh my-cassandra
注意，如果此命令无法启动 CQL Shell，而出现一个错误，指示“Unable to connect to any servers”，请稍
等一两分钟，然后重试。需要确保 Cassandra 集群已完全启动，然后再启动 CQL Shell。
当 shell 准备就绪后，请按如下方式使用 create keyspace 命令：
cqlsh> create keyspace tacocloud
... with replication={'class':'SimpleStrategy', 'replication_factor':1}
... and durable_writes=true;

--- 第 114 页 ---
114
简单地说，这将创建一个名为 tacocloud 的键空间，并在持久化时进行简单复制。通过将复制因子设置为 2，可
以让 Cassandra 为每行数据保留一个副本。复制策略决定了如何处理复制。这个 SimpleStrategy 复制策略适合
于单个数据中心（或演示环境）。但是如果您的 Cassandra 集群分布在多个数据中心，可以考虑
NetworkTopologyStrategy 复制策略。请参阅 Cassandra 有关文档，以了解相关复制策略信息，以及创建键空
间的其他替代方法。
现在已经创建了键空间，您需要配置 spring.cassandra.keyspace-name 属性来告诉 Spring Data Cassandra 使
用该键空间：
spring:
data:
cassandra:
keyspace-name: taco_cloud
schema-action: recreate
local-datacenter: datacenter1
这里，还设置了 spring.data.cassandra.schema-action 为 recreate-drop-unused。此设置对于开发环境非常有
用，因为它确保每次开始使用应用程序时，都会删除和重新创建任何表和用户定义类型。默认值 none 不执行任
何操作，这在生产环境中设置是正常的，因为不会希望应用程序开始时，删除所有表。
最后，spring.data.cassandra.local-datacenter 属性标识本地数据中心，用于设置 Cassandra 的负载均衡策略。
在单个节点中，设置了使用“datacenter1”这个值。有关 Cassandra 负载均衡策略的更多信息，以及如何设置本
地数据中心，请参阅 DataStax Cassandra 驱动程序参考文件。
这些是使用本地运行的 Cassandra 数据库所需的唯一配置。但是，依据您自己的 Cassandra 集群配置，除了这
两个属性之外，您还可以设置其他属性。
默认情况下，Spring Data Cassandra 假设 Cassandra 在本地运行并且监听端口 9042。如果你的环境中不是这
样，比如在生产环境中，您可能需要设置 spring.data.cassandra.contact-points 和 spring.data.cassandra.port
属性：
spring:
data:
cassandra:
keyspace-name: tacocloud
local-datacenter: datacenter1
contact-points:
- casshost-1.tacocloud.com
- casshost-2.tacocloud.com
- casshost-3.tacocloud.com
port: 9043
注意 spring.data.cassandra.contact-points 属性用于标识 Cassandra 的主机名。每一行指定一个正在运行
Cassandra 的主机节点。默认情况下，它设置为 localhost，但可以将其设置为主机名列表。它将尝试每个节
点，直到它能够连接到其实的一个。这是为了确保 Cassandra 集群中没有单点故障，应用程序将能够通过给定
的某一节点连接到群集。
您还可能需要为 Cassandra 集群指定用户名和密码。这可以设置 spring.data.cassandra.username 和
spring.data.cassandra.password 属性：

--- 第 115 页 ---
115
spring:
data:
cassandra:
...
username: tacocloud
password: s3cr3tP455w0rd
这样您的项目中启用并配置了 Spring Data Cassandra，您就可以将实体类型映射到 Cassandra 表和编写
Repository 了。但是首先，让我们先考虑一下 Cassandra 数据建模的几个基本点。

--- 第 116 页 ---
116
4.1.2 理解 Cassandra 数据模型
我已经提到过，Cassandra 与关系型数据库有很大的不同。在将实体类型映射到 Cassandra 表之前，先来了解
一下 Cassandra 数据建模的一些方法。这些建模方式不同于以往关系型数据库建模。
这些是 Cassandra 数据建模中最重要的几点：
Cassandra 表可以有任意数量的列，但不是所有的行都必须使用所有这些列。
Cassandra 数据库可以被分割到多个分区中。给定表中的任何行可能由一个或多个分区管理，但在每个分
区不太可能包含所有行。
Cassandra 表有两种键：分区键和聚类键。对每一行的分区键执行哈希操作，以确定由哪个分区对该行进
行管理。聚类键决定了在分区中维护的那些行的顺序（可能并不出现在查询结果中）。
Cassandra 针对读取操作进行了高度优化。因此，对于高度非规范化的表，或跨多个表允余数据保存的情
况是比较适合的。（例如，客户信息保存在客户数据表，同时也在客户下的订单表中保存一份副本。）
总之，将 Taco Cloud 中的实体类型适配成以 Cassandra 存储，不只是简单地把几个 JPA 注解替换成
Cassandra 注解的问题。您需要考虑如何对实体数据进行重新建模。

--- 第 117 页 ---
117
4.1.3 Cassandra 持久化实体映射
在第 3 章中，您在实体类型（Taco、Ingredient、Order 等等）上使用 JPA 规范提供的注解。这些注解将实体类
型映射到要持久化的关系型数据库表上。但这些注解在使用 Cassandra 进行持久化时不起作用，Spring Data
Cassandra 提供了一组自己的注解，用于完成类似的映射功能。
让我们从最简单的 Ingredient 类开始，这个新的 Ingredient 类如下所示：
package tacos;
import org.springframework.data.cassandra.core.mapping.PrimaryKey;
import org.springframework.data.cassandra.core.mapping.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
@Data
@AllArgsConstructor
@NoArgsConstructor(access=AccessLevel.PRIVATE, force=true)
@Table("ingredients")
public class Ingredient {
@PrimaryKey
private String id;
private String name;
private Type type;
public static enum Type {
WRAP, PROTEIN, VEGGIES, CHEESE, SAUCE
}
}
Ingredient 类似乎否定了我所说的只需替换一些注解。在这里不用 JPA 持久化那样的 @Entity 注解，而是用
@Table 注解，以指示应该将 Ingredient 持久化到一张名为 ingredients 的表中。不是用 @id 注解在 id 属性
上，而是用 @PrimaryKey 注解。到目前为止，您似乎只替换了很少的几个注解。
但别让 Ingredient 类欺骗了您。Ingredient 类是最简单的实体类型。当您处理 Taco 类时，事情会变得复杂。
程序清单 4.1 为 Taco 类添加 Cassandra 持久化注解

--- 第 118 页 ---
118
package tacos;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
import org.springframework.data.cassandra.core.cql.Ordering;
import org.springframework.data.cassandra.core.cql.PrimaryKeyType;
import org.springframework.data.cassandra.core.mapping.Column;
import org.springframework.data.cassandra.core.mapping.PrimaryKeyColumn;
import org.springframework.data.cassandra.core.mapping.Table;
import com.datastax.oss.driver.api.core.uuid.Uuids;
import lombok.Data;
@Data
@Table("tacos")
public class Taco {
@PrimaryKeyColumn(type=PrimaryKeyType.PARTITIONED)
private UUID id = Uuids.timeBased();
@NotNull
@Size(min = 5, message = "Name must be at least 5 characters long")
private String name;
@PrimaryKeyColumn(type=PrimaryKeyType.CLUSTERED,
ordering=Ordering.DESCENDING)
private Date createdAt = new Date();
@Size(min=1, message="You must choose at least 1 ingredient")
@Column("ingredients")
private List<IngredientUDT> ingredients = new ArrayList<>();
public void addIngredient(Ingredient ingredient) {
this.ingredients.add(TacoUDRUtils.toIngredientUDT(ingredient));
}
}
正如您所看到的，映射 Taco 类的内容更为复杂。与 Ingredient 一样， @Table 注解用于将 TACO 类标识为使用
tacos 表进行保存。但这是唯一与 Ingredient 类相似的地方。
id 属性仍然是主键，但它只是两个主键列中的一个。更具体地说，id 属性使用注解 @PrimaryKeyColumn ，且设置
类型为 PrimaryKeyType.PARTITIONED 。 这样设置指定了 id 属性作为分区键，用于确定每行 taco 应该将数据写入哪
个 Cassandra 分区。
您还注意到 id 属性现在是 UUID，而不是 Long 类型。尽管不是强制的，但 ID 值属性通常为 UUID 类型。此
外，新 Taco 对象的 UUID 是基于时间的 UUID 。（但从数据库读取已有的 Taco 时，可能会覆盖该值）。
再往下一点，您会看到 createdAt 属性被映射为主键列的另一个属性。本例中，设置了 @PrimaryKeyColumn 的
type 属性为 PrimaryKeyType.CLUSTERED ，它将 createdAt 属性指定为聚类键。如前所述，聚类键用于确定分区中
的行数据的顺序。更具体地说，排序设置为降序。因此，在给定的分区中，较新行首先出现在 tacos 表中。
最后， ingredients 属性现在是一个 IngredientUDT 对象的列表。正如您所记得的，Cassandra 表是非规范化
的，可能包含从其他表复制的数据。虽然 ingredients 表将作为所有可用 Ingredient 的记录表，但每个 taco 的
Ingredient 会在 ingredients 中重复出现。这不仅仅是简单地引用 ingredients 表中的一行或多行，而是在
ingredients 属性中包含完整数据。

--- 第 119 页 ---
119
但为什么要引入一个新的 IngredientUDT 类呢？为什么不重用 Ingredient 类呢？简单地说，包含数据集合的
列，例如 ingredients 列，必须是基本类型（整数、字符串等）或用户自定义类型的集合。
在 Cassandra 中，用户自定义的类型和基本类型相比，允许您声明更丰富的表和列属性。通常，它们类似关系
型数据库的外键。但与外键不同，外键只保存在另一个表的行数据中。但用户自定义类型的列，实际上可能携
带从另一个表的行中复制的数据。对于 tacos 表中的 ingredients 列，它将包含所有 ingredients 的数据。
不能将 Ingredient 类用作自定义的类型，因为 @Table 注解已经将其映射为 Cassandra 中持久化的一个实体。
因此，您必须创建一个新类，来定义如何在 taco 表上的 ingredients 列。IngredientUDT 类用于达到此目的
（其中 “UDT” 是 user defined type 的缩写，表示用户自定义类型）：
package tacos;
import org.springframework.data.cassandra.core.mapping.UserDefinedType;
import lombok.AccessLevel;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
@Data
@RequiredArgsConstructor
@NoArgsConstructor(access = AccessLevel.PRIVATE, force = true)
@UserDefinedType("ingredient")
public class IngredientUDT {
private final String name;
private final Ingredient.Type type;
}
尽管 IngredientUDT 看起来很像 Ingredient，但它的映射简单的多。它用 @UserDefinedType 注解，以将其标识为
用户自定义的类型。除此之外，它就是一个具有一些属性的简单类。
您还将注意到，IngredientUDT 类并不包含 id 属性。尽管它可能包含从 Ingredient 复制来的 id 属性的副本。事
实上，用户自定义的类型可能包含您需要的任何属性，它不需要与任何表定义进行一对一的映射。
我意