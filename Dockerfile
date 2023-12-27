FROM nginx
RUN echo "ok" > /usr/share/nginx/html/healthcheck
RUN echo "hello" > /usr/share/nginx/html/index.html
