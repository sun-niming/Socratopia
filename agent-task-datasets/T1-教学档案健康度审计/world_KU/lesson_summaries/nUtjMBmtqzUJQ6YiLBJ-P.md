<!-- windowStart: 60 -->
从第26页起学习Spring MVC控制器，HomeController用@Controller和@GetMapping返回字符串"home"，学习者被问页面由谁生成。随后转到第22页pom.xml，讲parent继承、starter依赖好处，学习者答数据库应找starter但误解为直接获得数据库服务，被纠正。第23页讲@SpringBootApplication三个子注解，学习者正确答出@ComponentScan负责发现@Controller。第24页空测试contextLoads，学习者理解其验证应用能否启动。最后讲第27页Thymeleaf模板渲染home.html，并提问图片应放在哪

…[summary trimmed; recent context preserved]

自动重启生效。

对话围绕《Spring实战》第35页起的教学内容展开。此前几轮中，学习者答对了依赖类加载器需手动重启、模板缓存生产开启开发关闭、自动配置依赖classpath与条件注解，以及核心容器加依赖注入是后续项目地基。随后进入Spring Boot小节，介绍Actuator、环境属性、测试支持与CLI四项能力。伙伴最后提问：Boot省掉了哪些活，让作者敢说无法想象没有Boot。

对话梳理了Spring核心概念：DI属核心框架，自动配置和starter属Boot；Spring Data通过接口和命名约定生成实现，经容器注册为bean后由DI注入；Spring Security区分身份验证（你是谁）与授权（你能碰什么）；Batch与Integration按“等不等”区分；Spring Cloud面向微服务间协作；Spring Native为实验性项目，不宜上生产。学习者大多答对，仅DI与Boot来源混淆，经引导后理解。

对话围绕 Spring MVC 展示信息展开。学习者理解了核心概念“动态”——配料不能硬编码进 HTML，需由数据库数据现拼。掌握了分工：控制器取数处理，视图渲染 HTML，浏览器先请求控制器。学习了三个实体：Ingredient（id、name、type 均为 final，构造后不可改，用 Lombok @Data）、Taco（含 List<Ingredient>）、TacoOrder（交付、付款信息及 List<Taco>）。学习者正确推出嵌套关系需两跳找到 Ingredient，并能区分视图渲染与 RESTful 直接写响应体的控制器类型。

讨论了Spring MVC中@Controller触发组件扫描、@GetMapping/@PostMapping按HTTP方法映射、Model与视图间数据传输及逻辑名解析。学习者答对组件扫描和@PostMapping，但混淆了两类控制器与视图的关系。伙伴纠正后，讲解了Model数据复制到请求属性，以及Thymeleaf的th:text、th:each渲染机制。学习者理解总体顺畅，能推理出逻辑名非写死。