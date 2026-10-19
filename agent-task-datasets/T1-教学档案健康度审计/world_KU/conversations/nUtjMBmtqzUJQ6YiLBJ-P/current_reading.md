<!-- startPage: 59 endPage: 79 -->
--- 第 59 页 ---
59
这样做的想法源于，在创建了一个玉米卷之后，用户将被重定向到一个订单表单，他们可以从该表单下订单，
以交付他们的玉米卷。但是还没有一个控制器来处理 /orders/current 请求。
根据现在对 @Controller 、 @RequestMapping 和 @GetMapping 的了解，可以轻松地创建这样的控制器。它可能类似
于下面的清单。
程序清单 2.8 展现玉米卷订单表单的控制器
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
iimport lombok.extern.slf4j.Slf4j;
import tacos.TacoOrder;
@Slf4j
@Controller
@RequestMapping("/orders")
public class OrderController {
@GetMapping("/current")
public String orderForm(Model model) {
model.addAttribute("tacoOrder", new TacoOrder());
return "orderForm";
}
}
同样，可以使用 Lombok 的 @Slf4j 注释在运行时创建一个 SLF4J Logger 对象。稍后，将使用这个 Logger 来
记录提交的订单的详细信息。
类级别的 @RequestMapping 指定该控制器中的任何请求处理方法都将处理路径以 /orders 开头的请求。当与方法
级 @GetMapping 结合使用时，它指定 orderForm() 方法将处理 /orders/current 的 HTTP GET 请求。
至于 orderForm() 方法本身，它非常简单，只返回 orderForm 的逻辑视图名。在第 3 章中，一旦有了把创建的
taco 持久化到数据库的方法，将重新访问该方法并修改它，以使用 taco 对象的列表填充模型，这些对象将按顺
序放置。
orderForm 视图由一个名为 orderForm.html 的 Thymeleaf 模板提供，如下面显示的。
程序清单 2.9 taco 订单表单视图

--- 第 60 页 ---
60
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
xmlns:th="http://www.thymeleaf.org">
<head>
<title>Taco Cloud</title>
<link rel="stylesheet" th:href="@{/styles.css}" />
</head>
<body>
<form method="POST" th:action="@{/orders}" th:object="${order}">
<h1>Order your taco creations!</h1>
<img th:src="@{/images/TacoCloud.png}"/>
<a th:href="@{/design}" id="another">Design another taco</a><br/>
<div th:if="${#fields.hasErrors()}">
<span class="validationError">
Please correct the problems below and resubmit.
</span>
</div>
<h3>Deliver my taco masterpieces to...</h3>
<label for="name">Name: </label>
<input type="text" th:field="*{name}"/>
<br/>
<label for="street">Street address: </label>
<input type="text" th:field="*{street}"/>
<br/>
<label for="city">City: </label>
<input type="text" th:field="*{city}"/>
<br/>
<label for="state">State: </label>
<input type="text" th:field="*{state}"/>
<br/>
<label for="zip">Zip code: </label>
<input type="text" th:field="*{zip}"/>
<br/>
<h3>Here's how I'll pay...</h3>
<label for="ccNumber">Credit Card #: </label>
<input type="text" th:field="*{ccNumber}"/>
<br/>
<label for="ccExpiration">Expiration: </label>
<input type="text" th:field="*{ccExpiration}"/>
<br/>
<label for="ccCVV">CVV: </label>
<input type="text" th:field="*{ccCVV}"/>
<br/>
<input type="submit" value="Submit order"/>
</form>
</body>
</html>
在大多数情况下，orderForm.html 视图是典型的 HTML/Thymeleaf 内容，没有什么值得注意的。但是注意，这
里的 <form> 标记与程序清单 2.5 中使用的 <form> 标记不同，因为它还指定了一个表单操作。如果没有指定操
作，表单将向呈现表单的相同 URL 提交 HTTP POST 请求。但是在这里，指定表单应该提交到 /orders（使用
Thymeleaf 的 @{…} 操作符作为上下文相关路径）。

--- 第 61 页 ---
61
因此，需要添加另外一个方法到 OrderController 类中，去处理 /orders 接口的 POST 请求。在进行到下一章之
前，还没有办法将订单持久化，因此在这里简化它 —— 类似于在下一个程序清单中看到的内容。
程序清单 2.10 处理 taco 订单提交
@PostMapping
public String processOrder(TacoOrder order) {
log.info("Order submitted: " + order);
return "redirect:/";
}
当调用 processOrder() 方法来处理提交的订单时，它将获得一个 order 对象，其属性绑定到提交的表单字段。
Order 非常像 Taco，是一个相当简单的类，它携带订单信息。
现在已经开发了一个 OrderController 和 order 表单视图，可以开始尝试运行了。打开浏览器访问
http://localhost:8080/design，为您的玉米卷选择一些原料，然后点击 Submit Your Taco 按钮。应该会看到类似
于图 2.4 所示的表单。

--- 第 62 页 ---
62
图 2.4 taco 订单表单
在表单中填写一些字段，然后按 Submit Order 按钮。与此同时，请密切关注应用程序日志，以查看订单信息。
当我尝试它，日志条目看起来像这样（重新格式化以适应这个页面的宽度）：
Order submitted: TacoOrder(deliveryName=Craig Walls, deliveryStreet=1234 7th
Street, deliveryCity=Somewhere, deliveryState=Who knows?, deliveryZip=zipzap,
ccNumber=Who can guess?, ccExpiration=Some day, ccCVV=See-vee-vee, tacos=[])
如果仔细查看来自测试订单的日志条目，可以看到，虽然 processOrder() 方法完成了它的工作并处理了表单提
交，但是它让一些错误的信息进来了。表单中的大多数字段包含的数据可能是不正确的。需要添加一些验证，
以确保提供的数据至少与所需的信息类型相似。

--- 第 63 页 ---
63
2.3 验证表单输入
当设计一个新的 taco 产品时，如果用户没有选择任何食材或者没有为他们的产品指定名称，该怎么办？当提交
订单时，如果他们没有填写所需的地址字段，该怎么办？或者，如果他们在信用卡字段中输入的值甚至不是有
效的信用卡号，该怎么办？
按照目前的情况，没有什么能阻止用户创建一个没有任何配料或空空如也的送货地址的玉米饼，甚至提交他们
最喜欢的歌曲的歌词作为信用卡号码。这是因为还没有指定应该如何验证这些字段。
执行表单验证的一种方法是在 processDesign() 和 processOrder() 方法中加入一堆 if/then 块，检查每个字段以
确保它满足适当的验证规则。但是这样做会很麻烦，并且难于阅读和调试。
幸运的是，Spring 支持 Java's Bean Validation API（也称为 JSR-303；https://jcp.org/en/jsr/detail?id=303）。
这使得声明验证规则比在应用程序代码中显式地编写声明逻辑更容易。使用 Spring Boot，不需要做任何特殊的
事情来将验证库添加到项目中，因为 Validation API 和 Validation API 的 Hibernate 实现作为Spring Boot web
启动程序的临时依赖项自动添加到了项目中。
要在 Spring MVC 中应用验证，需要这样做：
工程中添加 Spring 校验 starter。
对要验证的类声明验证规则：特别是 Taco 类。
指定验证应该在需要验证的控制器方法中执行，具体来说就是：DesignTacoController 的 processDesign()
方法和 OrderController 的 processOrder() 方法。
修改表单视图以显示验证错误。
Validation API 提供了几个可以放在域对象属性上声明验证规则的注解。Hibernate 的 Validation API 实现甚至添
加了更多的验证注解。通过将 Spring 校验 starter 添加到项目中，可以将两者都添加到项目构建中。Spring
Boot Starters 向导中，勾选 I/O 下的“Validation”复选框将完成这个工作。但是如果您更喜欢手动编辑，那么在
Maven 的 pom.xml 文件可以手工添加以下内容：
<dependency>
<groupId>org.springframework.boot</groupId>
<artifactId>spring-boot-starter-validation</artifactId>
</dependency>
或者，如果您使用的是 Gradle，那么这就是您需要的依赖项：
implementation 'org.springframework.boot:spring-boot-starter-validation'
注意：是否需要明确添加 Spring Validation starter？
在 Spring Boot 的早期版本中，Spring Validation starter 是自动包含在 web statert 中的。从 Spring Boot
2.3.0 开始， 如果要应用验证，则需要显式地将其添加到项目构建中。
添加好了校验 starter 以后，让我们看看如何应用这些注解来验证提交的 Taco 或 TacoOrder

--- 第 64 页 ---
64
2.3.1 声明验证规则
对于 Taco 类，希望确保 name 属性不是空的或 null 的，并且所选配料列表中至少有一项。下面的程序清单显示
了一个更新后的 Taco 类，它使用 @NotNull 和 @Size 来声明这些验证规则。
程序清单 2.11 为 Taco 域类添加验证
package tacos;
import java.util.List;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
import lombok.Data;
@Data
public class Taco {
@NotNull
@Size(min=5, message="Name must be at least 5 characters long")
private String name;
@NotNull
@Size(min=1, message="You must choose at least 1 ingredient")
private List<Ingredient> ingredients;
}
您会发现，除了要求 name 属性不为 null，同时您声明它应该有一个值是至少 5 个字符的长度。
当涉及到对提交玉米饼订单进行验证声明时，必须对 Order 类应用注解。对于地址的属性，只需要确保用户没
有留下任何空白字段。对于这一点，将使用 Hibernate Validator 的 @NotBlank 注解。
支付领域的验证是一个比较奇特的存在。您不仅需要确保 ccNumber 属性不为空，还要确保它包含的是一个有
效的信用卡号码的值。该 ccExpiration 属性必须符合 MM/YY（两位数的年/月）格式。而 ccCVV 属性必须是一
个三位的数字。为了实现这种验证，需要使用一些其他的 Java Bean Validation API 注解，同时需要从
Hibernate Validator 集合中借用一些验证注解。下面程序清单列出了验证 TacoOrder 类所需要的改变。
程序清单 2.12 验证 Order 属性字段

--- 第 65 页 ---
65
package tacos;
import javax.validation.constraints.Digits;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import org.hibernate.validator.constraints.CreditCardNumber;
import java.util.List;
import java.util.ArrayList;
import lombok.Data;
@Data
public class TacoOrder {
@NotBlank(message="Delivery name is required")
private String deliveryName;
@NotBlank(message="Street is required")
private String deliveryStreet;
@NotBlank(message="City is required")
private String deliveryCity;
@NotBlank(message="State is required")
private String deliveryState;
@NotBlank(message="Zip code is required")
private String deliveryZip;
@CreditCardNumber(message="Not a valid credit card number")
private String ccNumber;
@Pattern(regexp="^(0[1-9]|1[0-2])([\\/])([1-9][0-9])$",
message="Must be formatted MM/YY")
private String ccExpiration;
@Digits(integer=3, fraction=0, message="Invalid CVV")
private String ccCVV;
private List<Taco> tacos = new ArrayList<>();
public void addTaco(Taco taco) {
this.tacos.add(taco);
}
}
可以看到，ccNumber 属性用 @CreditCardNumber 进行了注解。该注解声明属性的值必须是通过 Luhn 算法
（https://en.wikipedia.org/wiki/Luhn_algorithm）检查过的有效信用卡号。这可以防止用户出错的数据和故意错
误的数据，但不能保证信用卡号码实际上被分配到一个帐户，或该帐户可以用于交易。
不幸的是，没有现成的注解来验证 ccExpiration 属性的 MM/YY 格式。我已经应用了 @Pattern 注解，为它提供
了一个正则表达式，以确保属性值符合所需的格式。如果想知道如何破译正则表达式，我建议查看许多在线正
则表达式指南，包括 http://www.regularexpressions.info/。正则表达式语法是一门黑暗的艺术，当然也超出了本
书的范围。
最后，用 @Digits 注解 ccCVV 属性，以确保值恰好包含三个数字。
所有的验证注解都包含一个消息属性，该属性定义了如果用户输入的信息不符合声明的验证规则的要求时将显
示给用户的消息。

--- 第 66 页 ---
66
2.3.2 在表单绑定时执行验证
既然已经声明了应该如何验证 Taco 和 TacoOrder，那么我们需要重新访问每个控制器，并指定应该在将表单提
交到各自的处理程序方法时执行验证。
要验证提交的 Taco，需要将 Java Bean Validation API 的 @Valid 注解添加到 DesignTacoController 的
processDesign() 方法的 Taco 参数中。
程序清单 2.13 验证 POST 来的 Taco
import javax.validation.Valid;
import org.springframework.validation.Errors;
...
@PostMapping
public String processTaco(@Valid @ModelAttribute("taco") Taco taco, Errors errors) {
if (errors.hasErrors()) {
return "design";
}
// Save the taco...
// We'll do this in chapter 3
log.info("Processing taco: " + taco);
return "redirect:/orders/current";
}
@Valid 注解告诉 Spring MVC 在提交的 Taco 对象绑定到提交的表单数据之后，以及调用 processDesign() 方法
之前，对提交的 Taco 对象执行验证。如果存在任何验证错误，这些错误的详细信息将在传递到 processDesign()
的错误对象中捕获。 processDesign() 的前几行查询 Errors 对象，询问它的 hasErrors() 方法是否存在任何验证
错误。如果有，该方法结束时不处理 Taco，并返回 “design” 视图名，以便重新显示表单。
要对提交的 TacoOrder 对象执行验证，还需要对 OrderController 的 processOrder() 方法进行类似的更改。
程序清单 2.14 验证 POST 来的 TacoOrder
@PostMapping
public String processOrder(@Valid TacoOrder order, Errors errors) {
if (errors.hasErrors()) {
return "orderForm";
}
log.info("Order submitted: " + order);
return "redirect:/";
}
在这两种情况下，如果没有验证错误，则允许该方法处理提交的数据。如果存在验证错误，则请求将被转发到
表单视图，以便用户有机会纠正其错误。
但是用户如何知道哪些错误需要改正呢？除非调出表单上的错误，否则用户将只能猜测如何成功提交表单。

--- 第 67 页 ---
67
2.3.3 显示验证错误
Thymeleaf 通过 fields 属性及其 th:errors 属性提供了对 Errors 对象的便捷访问。例如，要在信用卡号字段上
显示验证错误，可以添加一个 <span> 元素，该元素将这些错误引用用于订单模板，如下所示。
程序清单 2.15 显示验证错误
<<label for="ccNumber">Credit Card #: </label>
<input type="text" th:field="*{ccNumber}"/>
<span class="validationError"
th:if="${#fields.hasErrors('ccNumber')}"
th:errors="*{ccNumber}">CC Num Error</span>
除了可以用来设置错误样式以引起用户注意的 class 属性外， <span> 元素还使用 th:if 属性来决定是否显示
<span> 。fields 属性的 hasErrors() 方法检查 ccNumber 字段中是否有任何错误。如果有错误， <span> 将被渲
染。
th:errors 属性引用 ccNumber 字段，并且假设该字段存在错误，它将用验证消息替换 <span> 元素的占位符内
容。
如果在其他字段的订单表单周围使用类似的 <span> 标记，则在提交无效信息时可能会看到类似图 2.5 的表单。
这些错误表明姓名、城市和邮政编码字段被留空，所有的支付字段都不符合验证标准。

--- 第 68 页 ---
68
图 2.5 在订单表单上显示验证错误
现在 Taco Cloud 控制器不仅可以显示和捕获输入，还可以验证信息是否符合一些基本的验证规则。让我们后退
一步，重新考虑第 1 章中的 HomeController，看看另一种实现。

--- 第 69 页 ---
69
2.4 使用视图控制器
到目前为止，已经为 Taco Cloud 应用程序编写了三个控制器。尽管每个控制器在应用程序的功能上都有不同的
用途，但它们几乎都遵循相同的编程模型：
它们都用 @Controller 进行了注解，以表明它们是控制器类，应该由 Spring 组件扫描自动发现，并在
Spring 应用程序上下文中作为 bean 进行实例化。
除了 HomeController 之外，所有的控制器都在类级别上使用 @RequestMapping 进行注解，以定义控制器将
处理的基本请求模式。
它们都有一个或多个方法，这些方法都用 @GetMapping 或 @PostMapping 进行了注解，以提供关于哪些方法
应该处理哪些请求的细节。
即将编写的大多数控制器都将遵循这种模式。但是，如果一个控制器足够简单，不填充模型或流程输入（就像
HomeController 一样），那么还有另一种定义控制器的方法。请查看下一个程序清单，了解如何声明视图控制
器 —— 一个只将请求转发给视图的控制器。
程序清单 2.16 声明视图控制器
package tacos.web;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
@Configuration
public class WebConfig implements WebMvcConfigurer {
@Override
public void addViewControllers(ViewControllerRegistry registry) {
registry.addViewController("/").setViewName("home");
}
}
关于 @WebConfig 最值得注意的是它实现了 WebMvcConfigurer 接口。WebMvcConfigurer 定义了几个配置
Spring MVC 的方法。尽管它是一个接口，但它提供了所有方法的默认实现，因此只需覆盖所需的方法。在本例
中，覆盖了 addViewControllers() 方法。
addViewControllers() 方法提供了一个 ViewControllerRegistry，可以使用它来注册一个或多个视图控制器。在这
里，在注册表上调用 addViewController() ，传入 “/”，这是视图控制器处理 GET 请求的路径。该方法返回一个
ViewControllerRegistration 对象，在该对象上立即调用 setViewName() 来指定 home 作为应该转发 “/” 请求的视
图。
就像这样，已经能够用配置类中的几行代码替换 HomeController。现在可以删除 HomeController，应用程序的
行为应该与以前一样。惟一需要做的其他更改是重新访问第 1 章中的 HomeControllerTest，从 @WebMvcTest 注
解中删除对 HomeController 的引用，这样测试类就可以无错误地编译了。
这里，已经创建了一个新的 WebConfig 配置类来存放视图控制器声明。但是任何配置类都可以实现
WebMvcConfigurer 并覆盖 addViewController() 方法。例如，可以将相同的视图控制器声明添加到引导
TacoCloudApplication 类中，如下所示：

--- 第 70 页 ---
70
@SpringBootApplication
public class TacoCloudApplication implements WebMvcConfigurer {
public static void main(String[] args) {
SpringApplication.run(TacoCloudApplication.class, args);
}
@Override
public void addViewControllers(ViewControllerRegistry registry) {
registry.addViewController("/").setViewName("home");
}
}
通过扩展现有的配置类，可以避免创建新的配置类，从而降低项目工件数量。但是我倾向于为每种配置（web、
数据、安全性等等）创建一个新的配置类，保持应用程序引导配置的简洁。
说到视图控制器，更一般地说，是控制器将请求转发给的视图，到目前为止，已经为所有视图使用了
Thymeleaf。我非常喜欢 Thymeleaf，但也许你更喜欢应用程序视图的不同模板模型。让我们看看 Spring 支持
的许多视图选项。

--- 第 71 页 ---
71
2.5 选择视图模板库
在大多数情况下，对视图模板库的选择取决于个人喜好。Spring 非常灵活，支持许多常见的模板选项。除了一
些小的例外，所选择的模板库本身甚至不知道它是在 Spring 中工作的。表 2.2 列出了 Spring Boot 自动配置支
持的模板选项。
表 2.2 支持的模板选项
模板 Spring Boot starter 依赖
FreeMarker spring-boot-starter-freemarker
Groovy Templates spring-boot-starter-groovy-templates
JavaServer Page （JSP） None （provided by Tomcat or Jetty）
Mustache spring-boot-starter-mustache
Thymeleaf spring-boot-starter-thymeleaf
一般来说，可以选择想要的视图模板库，将其作为依赖项添加到构建中，然后开始在 /templates 目录中（在
Maven 或 Gradle 构建项目的 src/main/resources 目录下）编写模板。Spring Boot 将检测选择的模板库，并自
动配置所需的组件来为 Spring MVC 控制器提供视图。
已经在 Taco Cloud 应用程序中用 Thymeleaf 实现了这一点。在第 1 章中，在初始化项目时选择了 Thymeleaf
复选框。这导致 Spring Boot 的 Thymeleaf starter 被包含在 pom.xml 文件中。当应用程序启动时，Spring Boot
自动配置会检测到 Thymeleaf 的存在，并自动配置 Thymeleaf bean。现在要做的就是开始在 /templates 中编写
模板。
如果希望使用不同的模板库，只需在项目初始化时选择它，或者编辑现有的项目构建以包含新选择的模板库。
例如，假设想使用 Mustache 而不是 Thymeleaf。没有问题。只需访问项目 pom.xml 文件，将：
<dependency>
<groupId>org.springframework.boot</groupId>
<artifactId>spring-boot-starter-thymeleaf</artifactId>
</dependency>
替换为：
<dependency>
<groupId>org.springframework.boot</groupId>
<artifactId>spring-boot-starter-mustache</artifactId>
</dependency>
当然，需要确保使用 Mustache 语法而不是 Thymeleaf 标签来编写所有模板。Mustache 的使用细节（或选择的
任何模板语言）不在这本书的范围之内，但为了让你知道会发生什么，这里有一个从 Mustache 模板摘录过来的
片段，这个片段渲染了玉米卷设计表单的成分列表中的一个：

--- 第 72 页 ---
72
<h3>Designate your wrap:</h3>
{{#wrap}}
<div>
<input name="ingredients" type="checkbox" value="{{id}}" />
<span>{{name}}</span><br/>
</div>
{{/wrap}}
这是 Mustache 与第 2.1.3 节中的 Thymeleaf 片段的等价替换。 {{#wrap}} 块（以 {{/wrap}} 结尾）迭代
request 属性中的一个集合，该集合的键为 wrap，并为每个项目呈现嵌入的 HTML。 {{id}} 和 {{name}} 标记
引用项目的 id 和 name 属性（应该是一个 Ingredient）。
在表 2.2 中请注意，JSP 在构建中不需要任何特殊的依赖关系。这是因为 servlet 容器本身（默认情况下是
Tomcat）实现了 JSP 规范，因此不需要进一步的依赖关系。
但是如果选择使用 JSP，就会遇到一个问题。事实证明，Java servlet 容器 —— 包括嵌入式 Tomcat 和 Jetty 容
器 —— 通常在 /WEB-INF 下寻找 jsp。但是如果将应用程序构建为一个可执行的 JAR 文件，就没有办法满足这
个需求。因此，如果将应用程序构建为 WAR 文件并将其部署在传统的 servlet 容器中，那么 JSP 只是一个选
项。如果正在构建一个可执行的 JAR 文件，必须选择 Thymeleaf、FreeMarker 或表 2.2 中的其他选项之一。

--- 第 73 页 ---
73
2.5.1 缓存模板
默认情况下，模板在第一次使用时只解析一次，解析的结果被缓存以供后续使用。对于生产环境来说，这是一
个很好的特性，因为它可以防止对每个请求进行冗余的模板解析，从而提高性能。
但是，在开发时，这个特性并不那么好。假设启动了应用程序并点击了玉米卷设计页面，并决定对其进行一些
更改。当刷新 web 浏览器时，仍然会显示原始版本。查看更改的惟一方法是重新启动应用程序，这非常不方
便。
幸运的是，有一种方法可以禁用缓存。只需将 templateappropriate 高速缓存属性设置为 false。表 2.3 列出了每
个支持的模板库的缓存属性。
表 2.3 启用/禁用模板缓存的属性
模板缓存使能属性
Freemarker spring.freemarker.cache
Groovy Templates spring.groovy.template.cache
Mustache spring.mustache.cache
Thymeleaf spring.thymeleaf.cache
默认情况下，所有这些属性都设置为 true 以启用缓存。可以通过将其缓存属性设置为 false 来禁用所选模板引擎
的缓存。例如，要禁用 Thymeleaf 缓存，请在 application.properties 中添加以下行：
spring.thymeleaf.cache = false
惟一的问题是，在将应用程序部署到生产环境之前，一定要删除这一行(或将其设置为 true)。一种选择是在
profile 文件中设置属性。（我们将在第 5 章讨论 profiles 文件。）
一个更简单的选择是使用 Spring Boot 的 DevTools，就像我们在第 1 章中选择的那样。在 DevTools 提供的许多
有用的开发时帮助中，它将禁用所有模板库的缓存，但在部署应用程序时将禁用自身（从而重新启用模板缓
存）。

--- 第 74 页 ---
74
2.6 总结
Spring 提供了一个强大的 web 框架，称为 Spring MVC，可以用于开发 Spring 应用程序的 web 前端。
Spring MVC 是基于注解的，可以使用 @RequestMapping 、 @GetMapping 和 @PostMapping 等注解来声明请求处
理方法。
大多数请求处理方法通过返回视图的逻辑名称来结束，例如一个 Thymeleaf 模板，请求（以及任何模型数
据）被转发到该模板。
Spring MVC 通过 Java Bean Validation API 和 Hibernate Validator 等验证 API 的实现来支持验证。
视图控制器可以用来处理不需要模型数据或处理的 HTTP GET 请求。
除了 Thymeleaf，Spring 还支持多种视图选项，包括 FreeMarker、Groovy Templates 和 Mustache。

--- 第 75 页 ---
75
第 3 章处理数据
本章内容：
使用 Spring JdbcTemplate
创建 Spring Data JDBC Repository
使用 Spring Data 声明 JPA Repository
大多数应用程序提供的不仅仅是一张漂亮的脸。虽然用户界面可能提供与应用程序的交互，但它所呈现和存储
的数据将应用程序与静态网站区分开来。
在 Taco Cloud 应用程序中，需要能够维护关于 ingredients、tacos 和 orders 的信息。如果没有一个数据库来存
储这些信息，应用程序将无法比在第 2 章中开发的应用程序取得更大的进展。
在本章中，将向 Taco Cloud 应用程序添加数据持久化操作。首先使用 Spring 对 JDBC（Java Database
Connectivity）的支持来消除样板代码。然后，将重新使用 JPA（Java Persistence API）处理数据存储库，从
而消除更多代码。

--- 第 76 页 ---
76
3.1 使用 JDBC 读写数据
几十年来，关系数据库和 SQL 一直是数据持久化的首选。尽管近年来出现了许多替代数据库类型，但关系数据
库仍然是通用数据存储的首选，而且不太可能很快被取代。
在处理关系数据时，Java 开发人员有多个选择。两个最常见的选择是 JDBC 和 JPA。Spring 通过抽象支持这两
种方式，这使得使用 JDBC 或 JPA 比不使用 Spring 更容易。在本节中，我们将重点讨论 Spring 是如何支持
JDBC 的，然后在第 3.2 节中讨论 Spring 对 JPA 的支持。
Spring JDBC 支持起源于 JdbcTemplate 类。JdbcTemplate 提供了一种方法，通过这种方法，开发人员可以对
关系数据库执行 SQL 操作，与通常使用 JDBC 不同的是，这里不需要满足所有的条件和样板代码。
为了更好地理解 JdbcTemplate 的作用，我们首先来看一个示例，看看如何在没有 JdbcTemplate 的情况下用
Java 执行一个简单的查询。
程序清单 3.1 不使用 JdbcTemplate 查询数据库
@Override
public Optional<Ingredient> findById(String id) {
Connection connection = null;
PreparedStatement statement = null;
ResultSet resultSet = null;
try {
connection = dataSource.getConnection();
statement = connection.prepareStatement(
"select id, name, type from Ingredient");
statement.setString(1, id);
resultSet = statement.executeQuery();
Ingredient ingredient = null;
if(resultSet.next()) {
ingredient = new Ingredient(
resultSet.getString("id"),
resultSet.getString("name"),
Ingredient.Type.valueOf(resultSet.getString("type")));
}
return Optional.of(ingredient);
} catch (SQLException e) {
// ??? What should be done here ???
} finally {
if (resultSet != null) {
try {
resultSet.close();
} catch (SQLException e) {}
}
if (statement != null) {
try {
statement.close();
} catch (SQLException e) {}
}
if (connection != null) {
try {
connection.close();
} catch (SQLException e) {}
}
}
return null;
}

--- 第 77 页 ---
77
在程序清单 3.1 的某个地方，有几行代码用于查询数据库中的 ingredients。但是很难在 JDBC 的混乱代码中找
到查询指针。它被创建连接、创建语句和通过关闭连接、语句和结果集来清理的代码所包围。
更糟糕的是，在创建连接或语句或执行查询时，可能会出现许多问题。这要求捕获一个 SQLException，这可能
有助于（也可能无助于）找出问题出在哪里或如何解决问题。
SQLException 是一个被检查的异常，它需要在 catch 块中进行处理。但是最常见的问题，如未能创建到数据库
的连接或输入错误的查询，不可能在 catch 块中得到解决，可能会重新向上抛出以求处理。相反，要是考虑使用
JdbcTemplate 的方法。
程序清单 3.2 使用 JdbcTemplate 查询数据库
private JdbcTemplate jdbcTemplate;
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
程序清单 3.2 中的代码显然比程序清单 3.1 中的原始 JDBC 示例简单得多；没有创建任何语句或连接。而且，
在方法完成之后，不会对那些对象进行任何清理。最后，这样做不会存在任何在 catch 块中不能处理的异常。剩
下的代码只专注于执行查询（调用 JdbcTemplate 的 queryForObject() 方法）并将结果映射到 Ingredient 对象
（在 mapRowToIngredient() 方法中）。
程序清单 3.2 中的代码是使用 JdbcTemplate 在 Taco Cloud 应用程序中持久化和读取数据所需要做的工作的一
个片段。让我们采取下一步必要的步骤来为应用程序配备 JDBC 持久化。我们将首先对域对象进行一些调整。

--- 第 78 页 ---
78
3.1.1 为持久化改造领域实体
在将对象持久化到数据库时，通常最好有一个惟一标识对象的字段。Ingredient 类已经有一个 id 字段，但是需
要向 Taco 和 TacoOrder 添加 id 字段。
此外，了解何时创建 Taco 以及何时生成一个 TacoOrder 可能很有用。还需要向每个对象添加一个字段，以捕获
保存对象的日期和时间。下面的程序清单显示了 Taco 类中需要的新 id 和 createdAt 字段。
程序清单 3.3 向 Taco 类添加 id 和 timestamp 字段
@Data
public class Taco {
private Long id;
private Date createdAt;
...
}
因为使用 Lombok 在运行时自动生成访问器方法，所以除了声明 id 和 createdAt 属性外，不需要做任何事情。
它们将在运行时根据需要生成适当的 getter 和 setter 方法。TacoOrder 类也需要做类似的修改，如下所示：
@Data
public class TacoOrder implements Serializable {
private static final long serialVersionUID = 1L;
private Long id;
private Date placedAt;
// ...
}
同样，Lombok 会自动生成访问字段的方法，因此 TacoOrder 类只需要进行这些更改。（如果由于某种原因选
择不使用 Lombok，那么需要自己编写这些方法。）
领域类现在已经为持久化做好了准备。让我们看看如何使用 JdbcTemplate 对它们进行数据库读写。

--- 第 79 页 ---
79
3.1.2 使用 JdbcTemplate
在开始使用 JdbcTemplate 之前，需要将它添加到项目类路径中。这很容易通过添加 Spring Boot 的 JDBC
starter 依赖来实现：
<dependency>
<groupId>org.springframework.boot</groupId>
<artifactId>spring-boot-starter-jdbc</artifactId>
</dependency>
还需要一个存储数据的数据库。出于开发目的，嵌入式数据库也可以。我喜欢 H2 嵌入式数据库，所以我添加了
以下依赖进行构建：
<dependency>
<groupId>com.h2database</groupId>
<artifactId>h2</artifactId>
<scope>runtime</scope>
</dependency>
默认情况下，数据库名称是随机生成的。但这使得很难确定数据库连接 URL。因为需要使用 H2 控制台连接到
数据库（使用 Spring Boot DevTools 访问 http://localhost:8080/h2-console，所以指定确定的数据库名称这是个
好主意。这通过在 application.properties 中设置两个属性来实现：
spring.datasource.generate-unique-name=false
spring.datasource.name=tacocloud
或者，如果愿意，将 application.properties 重命名为 application.yml 并添加 YAML 格式的属性：
spring:
datasource:
generate-unique-name: false
name: tacocloud
属性文件格式和 YAML 格式之间的选择取决于您。Spring Boot 都支持。鉴于 YAML 的结构增加了可读性，本书
所有部分我们都将使用 YAML 格式来配置。
通过将 spring.datasource.generate-unique-name 属性设置为 false，我们可以看出 Spring 不再为数据库生成随
机值。相反，它应该使用 spring.datasource.name 属性的值。在这种情况下，数据库名称将是“tacocloud”。因
此，数据库 URL 将是 “"jdbc:h2:mem:tacocloud”，您可以在 JDBC UR L中指定 H2 控制台连接。
稍后，将看到如何配置应用程序来使用外部数据库。但是现在，让我们继续编写一个获取和保存 Ingredient 数
据的存储库。
定义 JDBC 存储库
Ingredient repository 需要执行以下操作：
查询所有的 Ingredient 使之变成一个 Ingredient 的集合对象
通过它的 id 查询单个 Ingredient
保存一个 Ingredient 对象
以下 IngredientRepository 接口将这三种操作定义为方法声明：