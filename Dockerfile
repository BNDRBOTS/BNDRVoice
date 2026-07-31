FROM nginx:1.27-alpine

# Railway injects PORT at runtime. The official Nginx entrypoint expands only
# ${PORT} in the template, leaving Nginx variables such as $uri untouched.
ENV PORT=8080
ENV NGINX_ENVSUBST_FILTER=^PORT$

# Static multi-page site and vendored visual assets.
COPY index.html /usr/share/nginx/html/index.html
COPY app.html /usr/share/nginx/html/app.html
COPY privacy.html /usr/share/nginx/html/privacy.html
COPY terms.html /usr/share/nginx/html/terms.html
COPY 404.html /usr/share/nginx/html/404.html
COPY 500.html /usr/share/nginx/html/500.html
COPY config.js /usr/share/nginx/html/config.js
COPY version.json /usr/share/nginx/html/version.json
COPY health.json /usr/share/nginx/html/health.json
COPY robots.txt /usr/share/nginx/html/robots.txt
COPY sitemap.xml /usr/share/nginx/html/sitemap.xml
COPY assets/ /usr/share/nginx/html/assets/

COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=3s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["nginx", "-g", "daemon off;"]
