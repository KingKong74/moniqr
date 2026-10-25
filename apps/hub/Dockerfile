# Holding page for moniqr.com until the phase 2 hub replaces it.
# Build from the repo root: docker build -f apps/hub/Dockerfile .

FROM nginx:1.27-alpine
COPY apps/hub/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/hub/public /usr/share/nginx/html
EXPOSE 80
