# B5 传输层冒烟用最小 sshd:密码认证(M1-B10 再扩展私钥/OTP 用户)
# 基础镜像复用本地已有的 alpine 系镜像,避免额外拉取。
FROM redis:7-alpine

RUN apk add --no-cache openssh-server
RUN ssh-keygen -A
RUN echo "root:shelxpass" | chpasswd
RUN sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
