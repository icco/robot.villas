FROM nginx
ENV NGINX_PORT 8080
EXPOSE 8080
RUN echo "ok" > /usr/share/nginx/html/healthcheck
