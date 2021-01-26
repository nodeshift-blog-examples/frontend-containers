# Building Rootless Containers for JavaScript Front-Ends
By default, most containers are running as the root user. It is much easier to install dependencies, edit files and run processes on restricted ports when they run as root. As is usually the case in computer science, though, simplicity comes at a cost. In this case, those containers are more vulnerable to some malicious code and attacks.
Those potential security gaps are the reason why OpenShift won't let you run containers as a root user. This adds an additional layer of security and isolates the containers even more.

## Rootless Containers for Front-ends
This blog post will show you how you can run your front-end container in a rootless container. This article builds on top of the code used for the [Accessing Environment Variables In Front-End Containers](https://developers.redhat.com/blog/?p=861157&preview=true) post.
This Dockerfile will let you access environment variables from your Angular, React or VueJS application. Let's take a look at that file as the starting point.

```
FROM node:14

ENV JQ_VERSION=1.6
RUN wget --no-check-certificate https://github.com/stedolan/jq/releases/download/jq-${JQ_VERSION}/jq-linux64 -O /tmp/jq-linux64
RUN cp /tmp/jq-linux64 /usr/bin/jq
RUN chmod +x /usr/bin/jq

WORKDIR /app
COPY . .
RUN jq 'to_entries | map_values({ (.key) : ("$" + .key) }) | reduce .[] as $item ({}; . + $item)' ./src/config.json | ./src/config.tmp.json && mv ./src/config.tmp.json config.json
RUN npm install && npm run build

FROM nginx:1.17
# Angular: ENV JSFOLDER=/usr/share/nginx/html/*.js
# React: ENV JSFOLDER=/usr/share/nginx/html/static/js/*.js
# VueJS: ENV JSFOLDER=/usr/share/nginx/html/js/*.js
COPY ./start-nginx.sh /usr/bin/start-nginx.sh
RUN chmod +x /usr/bin/start-nginx.sh
WORKDIR /usr/share/nginx/html
# Angular: COPY --from=0 /app/dist/<projectName> .
# React: COPY --from=0 /app/build .
# VueJS: COPY --from=0 /app/dist .
ENTRYPOINT [ "start-nginx.sh" ]
```

This container uses two stages to build the final container. The first stage, which uses the `node:14` image, runs as root, but it doesn't matter. The build process will discard the container from the first step, so you don't need to worry about it.

The second stage container, on the other hand, is the one that will need to be secured. The `nginx` base image is running as root. The main reason for this is to run on port 80, which requires privilege access to enable. Once this container is ready to run rootless, it will do so on port 8080.  For that to happen, we will need to change the default nginx configuration. We will also need to make sure that the server itself is running as an unprivileged user. This user will need access to several files and folders. 

So let's get started in making this container a rootless one.

## Nginx Configuration
The first step will be to create a new configuration file for Nginx. To do so, you will start with the absolute most basic configuration file needed to run Nginx and build it from there.

_nginx.conf_
```
worker_processes auto;
events {
  worker_connections 1024;
}
http {
  include /etc/nginx/mime.types;
  server {
    server_name _;
    index index.html;
    location / {
      try_files $uri /index.html;
      }
    }
}
```

Next, you will need to change the server settings to run on port 8080 instead of the default port 80 and change the default path that Nginx will use to serve files.

_nginx.conf_
```
http {
  ...
  server {
    listen 8080;
    ...
    location / {
      root /code;
      ...
    }
  }
}
```

Your final nginx.conf file should look like this.

_nginx.conf_
```
worker_processes auto;
events {
  worker_connections 1024;
}
http {
  include /etc/nginx/mime.types;
  server {
    listen 8080;
    server_name _;
    index index.html;
    location / {
      root /opt/app;
      try_files $uri /index.html;
    }
  }
}
```

Now that you have a new Nginx configuration file that will let the server run as a regular user, it's time for you to edit your Dockerfile. This modified container will run as user nginx. In this case, the Nginx base images provide us with this non-root user.

In the second step of your build, right after you've specified your base image with the FROM statement, you can COPY your new Nginx configuration file to overwrite the default one. Then, you can create a /opt/app folder and change the ownership of it.

```
FROM nginx:1.17
COPY ./nginx.conf /etc/nginx/nginx.conf
RUN mkdir -p /opt/app && chown -R nginx:nginx /opt/app && chmod -R 755 /opt/app
```

Don't forget to change the JSFOLDER variable for your bash script to inject the environment variables in your application still works.

```
# Angular
# ENV JSFOLDER=/opt/app/*.js
# React
# ENV JSFOLDER=/opt/app/static/js/*.js
# VueJS 
# ENV JSFOLDER=/opt/app/js/*.js
```

Next, there is a series of files and folders that Nginx needs access to run. Those files are for caching and logging purposes. You can change the ownership of all of them in a single RUN statement using ampersands to chain those commands.

```
RUN chown -R nginx:nginx /var/cache/nginx && \
   chown -R nginx:nginx /var/log/nginx && \
   chown -R nginx:nginx /etc/nginx/conf.d
```

Nginx also requires an nginx.pid file. This file does not exist yet, so you need to create it and assign the ownership to the nginx user.

```
RUN touch /var/run/nginx.pid && \
   chown -R nginx:nginx /var/run/nginx.pid  
```

Finally, you will need to change the group for those files and folders and change the permissions so that Nginx can read and write these folders.

```
RUN chgrp -R root /var/cache/nginx /var/run /var/log/nginx /var/run/nginx.pid && \
   chmod -R 755 /var/cache/nginx /var/run /var/log/nginx /var/run/nginx.pid
```

Now that you adjusted all the permissions, you can tell Docker to switch over to the nginx user using the USER statement. You can then copy the files from the builder step into the /opt/app folder using the --chown flag so that the files will be accessible by the nginx user. Finally, you will need to tell Docker that this new image uses a different port. To do this, you will use the EXPOSE statement for port 8080.

```
USER nginx
WORKDIR /opt/app
COPY --from=builder --chown=nginx <prod build folder> .
EXPOSE 8080
```

Your final front/Dockerfile will look like this.

```
FROM node:14

ENV JQ_VERSION=1.6
RUN wget --no-check-certificate https://github.com/stedolan/jq/releases/download/jq-${JQ_VERSION}/jq-linux64 -O /tmp/jq-linux64
RUN cp /tmp/jq-linux64 /usr/bin/jq
RUN chmod +x /usr/bin/jq

WORKDIR /app
COPY . .
RUN jq 'to_entries | map_values({ (.key) : ("$" + .key) }) | reduce .[] as $item ({}; . + $item)' ./src/config.json | ./src/config.tmp.json && mv ./src/config.tmp.json config.json
RUN npm install && npm run build

FROM nginx:1.17
# Angular
# ENV JSFOLDER=/opt/app/*.js
# React
# ENV JSFOLDER=/opt/app/static/js/*.js
# VueJS 
# ENV JSFOLDER=/opt/app/js/*.js
COPY ./nginx.conf /etc/nginx/nginx.conf
RUN mkdir -p /opt/app && chown -R nginx:nginx /opt/app && chmod -R 755 /opt/app
RUN chown -R nginx:nginx /var/cache/nginx && \
   chown -R nginx:nginx /var/log/nginx && \
   chown -R nginx:nginx /etc/nginx/conf.d
RUN touch /var/run/nginx.pid && \
   chown -R nginx:nginx /var/run/nginx.pid  
RUN chgrp -R root /var/cache/nginx /var/run /var/log/nginx /var/run/nginx.pid && \
   chmod -R 755 /var/cache/nginx /var/run /var/log/nginx /var/run/nginx.pid
COPY ./start-nginx.sh /usr/bin/start-nginx.sh
RUN chmod +x /usr/bin/start-nginx.sh

USER nginx
WORKDIR /opt/app
# Angular
# COPY --from=0 --chown=nginx /app/dist/<projectName> .
# React
# COPY --from=0 /app/build .
# VueJS
# COPY --from=0 /app/dist .
ENTRYPOINT [ "start-nginx.sh" ]
```

Your new Dockerfile is ready to go. You can test it out by using a `docker build` followed by a `docker run`. Don't forget to map the new port since this container doesn't run on port 80 any more.

```
docker build -t frontend .
docker run -d -p 8080:8080 --rm --name front -e ENV=prod -e BASE_URL=/api frontend
```

## Summary
You now have everything you need to run your JavaScript front-end in a secure container. You can reuse this image for all of your projects, whether using Angular, React or Vue. It is not only running securely but also lets you inject your environment variables into your code. You will find all the examples and source code on [Github](http://github.com/joellord/frontend-containers).