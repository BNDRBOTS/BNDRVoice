FROM nginx:1.27-alpine

# Static multi-page site
COPY index.html /usr/share/nginx/html/index.html
COPY app.html /usr/share/nginx/html/app.html
COPY privacy.html /usr/share/nginx/html/privacy.html
COPY terms.html /usr/share/nginx/html/terms.html
COPY config.js /usr/share/nginx/html/config.js

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
