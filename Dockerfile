FROM nginx:1.27-alpine

# Remove default nginx page
RUN rm -f /usr/share/nginx/html/*

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the app (Railway expects index.html at root)
COPY APEXSound_VoiceEngine.html /usr/share/nginx/html/index.html

# Health check — Railway polls /health to confirm the container is alive
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/health || exit 1

EXPOSE 80
