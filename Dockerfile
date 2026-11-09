FROM nginx:alpine
COPY index.html style.css app.js favicon.ico /usr/share/nginx/html/
EXPOSE 80
