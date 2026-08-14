# WebServer 项目上下文

## 项目位置

- 项目目录：`C:\Users\ASUS\webserver`
- WSL 中对应路径：`~/webserver`
- 当前目标：完成 12 号题“简单 Web 服务器程序设计与实现”
- 技术路线：C 语言 + Linux Socket + HTTP 静态文件服务器

## 当前项目结构

```text
webserver/
  Makefile
  README.md
  include/
    config.h
    file_server.h
    log.h
    mime.h
    request.h
    response.h
    server.h
    utils.h
  src/
    config.c
    file_server.c
    log.c
    main.c
    mime.c
    request.c
    response.c
    server.c
    utils.c
  logs/
    access.log
  tests/
    curl_test.sh
  www/
    index.html
```

## 已完成/已讨论内容

### 1. Makefile

Makefile 已经从错误的“只编译第一个目标”改成正确的编译和链接流程：

```makefile
$(TARGET): $(OBJ)
	$(CC) $(CFLAGS) $(OBJ) -o $(TARGET)

%.o: %.c
	$(CC) $(CFLAGS) $(CPPFLAGS) -c $< -o $@
```

最近一次 `make` 输出：

```text
gcc -Wall -Wextra -g -std=c11 -Iinclude -c src/file_server.c -o src/file_server.o
gcc -Wall -Wextra -g -std=c11 src/main.o src/config.o src/server.o src/request.o src/response.o src/file_server.o src/mime.o src/log.o src/utils.o -o webserver
```

没有 `error`、`undefined reference`、`make: ***`，说明已经成功生成可执行文件 `webserver`。

### 2. config.h / config.c

`ServerConfig` 的作用：保存服务器运行配置。

字段含义：

```c
typedef struct {
    int port;                  // 监听端口
    char root[PATH_MAX];       // 网站根目录原始路径
    char root_real[PATH_MAX];  // 网站根目录真实绝对路径
    char index[128];           // 默认首页
    char log_path[PATH_MAX];   // 日志路径
} ServerConfig;
```

`load_config()` 的作用：

1. 写入默认配置。
2. 读取命令行参数。
3. 校验端口。
4. 使用 `realpath()` 得到网站根目录真实路径。

命令行参数形式：

```bash
./webserver -p 8000 -r ./www -i index.html -l ./logs/access.log
```

曾经的问题：

- `PATH_MAX` 未声明。
- `dst = NULL` 写成赋值，应为 `dst == NULL`。
- `getopt()` / `optarg` 未声明。
- `realpath()` 隐式声明。
- `load_config()` 成功路径缺少 `return 0;`。

已给出的修复建议：

```c
#define _XOPEN_SOURCE 700

#include "config.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
```

并在函数末尾：

```c
if (realpath(config->root, config->root_real) == NULL) {
    perror("realpath root");
    return -1;
}

return 0;
```

建议默认路径：

```c
#define ROOT "./www"
#define LOG "./logs/access.log"
```

### 3. server.c

`server.c` 的职责：

- 创建监听 socket。
- 设置 `SO_REUSEADDR`。
- `bind()` 绑定端口。
- `listen()` 开始监听。
- `accept()` 接收客户端。
- `handle_client()` 处理一次 HTTP 请求。

`serve_forever()` 推荐写法：

```c
while (1) {
    int client_fd = accept(...);
    handle_client(client_fd, &client_addr, config);
    close(client_fd);
}
```

注意：

- 不要写 `while (listen_fd)` 判断 socket 是否关闭。
- `listen_fd` 只是整数，`close(listen_fd)` 不会自动把它变成 0。
- 当前版本是单进程处理请求，可以先跑通。
- fork 并发可作为后续扩展。

`handle_client()` 的职责：

1. `recv()` 读取 HTTP 请求。
2. 调用 `parse_request_line()`。
3. 非 GET 返回 405。
4. 请求格式错误返回 400。
5. 正常请求调用 `send_static_file()`。
6. 最后调用 `write_access_log()`。

### 4. request.c

`parse_request_line()` 的作用：

解析：

```text
GET /index.html HTTP/1.1
```

得到：

- `method`
- `path`
- `version`

当前逻辑：

- 格式不对返回 `-1`。
- 方法不是 GET 返回 `405`。
- path 不以 `/` 开头返回 `-1`。
- 成功返回 `0`。

### 5. response.c

`send_all()` 的作用：

循环调用 `send()`，保证指定长度的数据尽量完整发送。

原因：一次 `send()` 不保证发完所有字节。

`send_error()` 的作用：

生成标准 HTTP 错误响应，例如：

- 400
- 403
- 404
- 405
- 500

并更新：

```c
result->status
result->bytes
```

注意：

- `response.c` 使用 `send()`，需要包含 `<sys/socket.h>`。
- 其他文件只需要包含 `"response.h"` 使用 `send_all()` / `send_error()`。

### 6. mime.c

`mime.c` 的职责：根据文件扩展名返回 `Content-Type`。

核心函数：

```c
const char *get_mime_type(const char *path);
```

典型映射：

```text
.html -> text/html; charset=utf-8
.css  -> text/css; charset=utf-8
.js   -> application/javascript; charset=utf-8
.json -> application/json; charset=utf-8
.txt  -> text/plain; charset=utf-8
.png  -> image/png
.jpg  -> image/jpeg
.jpeg -> image/jpeg
.gif  -> image/gif
.ico  -> image/x-icon
其他  -> application/octet-stream
```

曾经的错误：

```c
get_time_type(resolved)
```

应该是：

```c
get_mime_type(resolved)
```

这个错误导致：

```text
undefined reference to `get_time_type'
```

改正后 `make` 已经通过。

### 7. utils.c

`utils.c` 是路径安全工具。

应实现：

```c
int url_decode(const char *src, char *dst, size_t dst_len);
int validate_url_path(const char *decoded_path);
int is_under_root(const char *root, const char *path);
```

作用：

- `url_decode()`：把 `%2e%2e%2f` 解码成 `../`。
- `validate_url_path()`：拒绝危险路径，例如 `..`、反斜杠。
- `is_under_root()`：确保 `realpath()` 后的文件仍在网站根目录内。

关键安全点：

不能只用：

```c
strncmp(path, root, strlen(root)) == 0
```

因为：

```text
/home/user/www2
```

也以：

```text
/home/user/www
```

开头。

必须检查边界：

```c
path[root_len] == '\0' || path[root_len] == '/'
```

### 8. file_server.c

`file_server.c` 是静态文件服务核心。

核心函数：

```c
int send_static_file(int client_fd,
                     const ServerConfig *config,
                     const char *url_path,
                     HttpResult *result);
```

功能流程：

1. 去掉 URL 查询参数，例如 `?a=1`。
2. URL 解码。
3. 路径安全初筛。
4. `/` 映射到首页文件。
5. 拼接候选文件路径。
6. `stat()` 判断文件是否存在。
7. `realpath()` 得到真实路径。
8. `is_under_root()` 确保没有逃出网站根目录。
9. `S_ISREG()` 判断是否普通文件。
10. `open()` 打开文件。
11. `get_mime_type()` 判断 MIME。
12. 发送 HTTP 200 响应头。
13. 循环 `read()` 文件并 `send_all()`。
14. 更新 `result->status = 200` 和 `result->bytes`。

### 9. log.c

`log.c` 的职责：记录访问日志。

核心函数：

```c
void write_access_log(const ServerConfig *config,
                      const char *client_ip,
                      const HttpRequest *req,
                      const HttpResult *result);
```

日志格式建议：

```text
2026-06-30 15:30:01 127.0.0.1 GET /index.html 200 1024
```

应记录：

- 时间
- IP
- 方法
- 路径
- 状态码
- 字节数

## 当前已知状态

最近一次 `make` 已通过，说明：

- `get_time_type` 拼写错误已修复。
- `mime.c` 等文件至少已经参与编译和链接。
- 已生成可执行文件 `webserver`。

## 下一步测试

在 WSL 项目目录：

```bash
./webserver
```

另开终端测试：

```bash
curl -i http://127.0.0.1:8000/
curl -i http://127.0.0.1:8000/not-found.html
curl -i -X POST http://127.0.0.1:8000/
curl -i http://127.0.0.1:8000/../../etc/passwd
curl -i http://127.0.0.1:8000/%2e%2e/%2e%2e/etc/passwd
tail -n 20 logs/access.log
```

预期：

```text
/                         -> 200
/not-found.html           -> 404
POST /                    -> 405
/../../etc/passwd         -> 403 或 400
/%2e%2e/%2e%2e/etc/passwd -> 403 或 400
logs/access.log           -> 有访问记录
```

## 重要提醒

如果从 `webserver/` 目录运行：

```bash
./webserver
```

默认配置应使用：

```c
#define ROOT "./www"
#define LOG "./logs/access.log"
```

不要使用：

```c
#define ROOT "../www"
#define LOG "../logs/access.log"
```

否则路径会指向项目目录的上一级。

