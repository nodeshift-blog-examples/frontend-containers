# Accessing Environment Variables in Front-End Containers
When building a container for a single page application (SPA) using any modern JavaScript framework such as Angular, React or VueJs, a problem will likely arise. Some configuration settings will be different depending on where this container will be running. A typical case would be the base URL of your API. It will most likely be different when testing the application or deploying it into your production environment. This problem is usually solved using environment variables. Those usually work in a back-end since the code runs in the background, but how can you do the same for an application that lives in a user's browser?

There are many ways around this limitation. Some developers will build a server that will have an endpoint with those parameters. Others will use PHP to inject those environment variables as globals in the JavaScript code. Those options work, but an ideal solution would be to inject those environment variables as part of the container build process. This way, it doesn't require changes in the codebase, and the content can still be delivered using a static web server such as Nginx.

This post will explain how to inject your environment variables directly into your codebase as you build your container.

## React, Angular, VueJs and production builds
It doesn't matter which framework you are using; they are virtually all working the same way. The framework runs a server that watches the files, and it refreshes the browser when a change is detected. This process is excellent for development purposes. Not so much for your production server, though. It has too much code and requires a lot of resources to run. For this content to work in a web server, a build step needs to happen to minimize the code and keep only the necessary parts. A package is then created typically with a single HTML, JS and CSS page. When a container runs in a production environment, it will serve this minified package. 

It turns out that the container building step that prepares your code for production is also a great place to inject the environment variables. In this blog post, you will see how to do this.

## Create a skeleton application
First, start with a skeleton application built with the CLI for your framework.

```
# Angular
npx @angular/cli new angular-project
# React
npx create-react-app react-project
# VueJS
npx @vue/cli create vue-project
```

For your project of choice, create a `config.json` in the `/src` folder. This file will contain some settings that could change based on the environment. In this case, it will have two properties, one to specify the environment and another one for the base URL of your imaginary API.

_config.json_
```
{
  "ENV": "development",
  "BASE_URL": "http://localhost:3000"
}
```

For the sake of simplicity, the application you are using will display those values on the main page. Head over to your main page, import the configuration file and display both values on that view.

### Angular: 
> Note: To import a JSON file, the following options might need to be added to the compilerOptions of the `tsconfig.json` file.
```
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
```

_src/app/app.component.ts_
```
import { Component } from '@angular/core';
import Config from "../config.json";

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html'
})
export class AppComponent {
  environment = Config.ENV;
  baseUrl = Config.BASE_URL;
}
```

_src/app/app.component.html_
```
<div>
  <p>Environment: {{ environment }}</p>
  <p>Base Url: {{ baseUrl }}</p>
</div>
```

### React
_src/App.js_
```
import Config from "./config.json";

function App() {
  const environment = Config.ENV;
  const baseUrl = Config.BASE_URL;
  return (
    <div>
      <p>Environment: { environment }</p>
      <p>Base Url: { baseUrl }</p>
    </div>
  );
}

export default App;
```

### VueJS
_src/App.vue_
```
<template>
  <div>
    <p>Environment: {{ environment }}</p>
    <p>Base Url: {{ baseUrl }}</p>
  </div>
</template>

<script>
import Config from "./config.json";

export default {
  name: 'App',
  data: () => {
    return {
      environment: Config.ENV,
      baseUrl: Config.BASE_URL
    }
  }
}
</script>
```

## Multi-Stage Build Containers
It is now time to build that container for the front-end. This process will use a container to create the production version of the application. Docker will then copy this build function's output into a second container, an Nginx server. The first container is then discarded, leaving only the Nginx server with the minimal set of files from the prior stage.

Let's start by creating an image that will contain the application. We will come back to apply those environment variables later.

Create a new file called `Dockerfile`. The first stage will use a `node:14` image to build the production version of the application. Copy over all of your files into the container.

> Note: To avoid copying unnecessary files such as the node_modules folders, create a `.docker-ignore` file in the same folder as your `Dockerfile` and list the folders to ignore. 

Copy the files, then run an npm install to fetch the project's dependencies and run an `npm run build` to create the production assets.

Then, start the second stage with `FROM nginx:1.17` statement and copy the files from the first stage into this new container.

> Note: The location of the production code varies based on the JavaScript framework that is used. Uncomment the line you need. For Angular, you will need to change the name of your project manually.

_Dockerfile_
```
FROM node:14
WORKDIR /app
COPY . .
RUN npm install && npm run build

FROM nginx:1.17
WORKDIR /usr/share/nginx/html
# Angular
# COPY --from=0 /app/dist/<projectName> .
# React
# COPY --from=0 /app/build .
# VueJS
# COPY --from=0 /app/dist .
```

After creating the Dockerfile, you are ready to build that image and start the container to test it out. Run the following commands and open up your browser to [http://localhost:8080](http://localhost:8080).

```
docker build -t front-end.
docker run -d -p 8080:80 --rm --name front frontend
```

You can stop the container after you tested it out with:

```
docker stop front
```

## Injecting the environment variables
It is now time to change this Dockerfile to inject some environment variables. In the next few steps, we will overwrite the content of the config.json file. Instead of having actual values, each property's value will be "$key". The result with the current config.json will be

```
{
  ENV: "$ENV",
  BASE_URL: "$BASE_URL"
}
```

The idea is to then use `envsubst` to change those $KEY to the environment variable's real value just before the server starts.

In the first step of the Dockerfile, add some instructions to add [jq](https://stedolan.github.io/jq/manual/). Jq is a tool that makes it easy to edit the content of a JSON file from the CLI.

Right after the `FROM` line, add the following to install jq in the container.

```
ENV JQ_VERSION=1.6
RUN wget --no-check-certificate https://github.com/stedolan/jq/releases/download/jq-${JQ_VERSION}/jq-linux64 -O /tmp/jq-linux64
RUN cp /tmp/jq-linux64 /usr/bin/jq
RUN chmod +x /usr/bin/jq
```

After the files have been copied, you can use jq to edit the config.json. If you want to learn more about the jq filter that is used, you can run it in [jqTerm](https://jqterm.com/6c7b25a7a016fb7fd4b62da2c41c2c54?query=to_entries%20%7C%20map_values%28%7B%20%28.key%29%20%3A%20%28%22%24%22%20%2B%20.key%29%20%7D%29%20%7C%20reduce%20.%5B%5D%20as%20%24item%20%28%7B%7D%3B%20.%20%2B%20%24item%29) to experiment with other options.

```
RUN jq 'to_entries | map_values({ (.key) : ("$" + .key) }) | reduce .[] as $item ({}; . + $item)' ./src/config.json > ./src/config.tmp.json && mv ./src/config.tmp.json ./src/config.json
```

After you modified the `config.json` file, it's time to tweak the Nginx server to inject the environment variables. To do so, you will need to create a script to be executed before starting the Nginx server. 

There is quite a bit of bash scripting going on in this file. The first line of bash script runs a command to get the names of all existing environment variables and stores those in `$EXISTING_VARS`. 

This script then loops through each JavaScript file in your production folder and replace any $VARIABLE with the actual value of that environment variable. Once it's done, it starts the Nginx server with the default command.

> Note: The location of the JavaScript files differ for each framework. The $JSFOLDER variable is set in the Dockerfile to uncomment the line you need in there.

_start-nginx.sh_
```
#!/usr/bin/env bash
export EXISTING_VARS=$(printenv | awk -F= '{print $1}' | sed 's/^/\$/g' | paste -sd,); 
for file in $JSFOLDER;
do
  cat $file | envsubst $EXISTING_VARS > $file.tmp
  mv $file.tmp $file
done
nginx -g 'daemon off;'
```

Now add this file to the container and overwrite the default entry point from the Nginx image with this new script. Right after the `FROM` statement of the second stage, add the following lines.

```
# Angular
# ENV JSFOLDER=/usr/share/nginx/html/*.js
# React
# ENV JSFOLDER=/usr/share/nginx/html/static/js/*.js
# VueJS 
# ENV JSFOLDER=/usr/share/nginx/html/js/*.js
COPY ./start-nginx.sh /usr/bin/start-nginx.sh
RUN chmod +x /usr/bin/start-nginx.sh
```

And completely at the end of the file, add the new entry point.

```
ENTRYPOINT [ "start-nginx.sh" ]
```

Your final Dockerfile should now look like this. You can uncomment the required lines and remove all the other commented statements.

_Dockerfile_
```
FROM node:14
ENV JQ_VERSION=1.6
RUN wget --no-check-certificate https://github.com/stedolan/jq/releases/download/jq-${JQ_VERSION}/jq-linux64 -O /tmp/jq-linux64
RUN cp /tmp/jq-linux64 /usr/bin/jq
RUN chmod +x /usr/bin/jq
WORKDIR /app
COPY . .
RUN jq 'to_entries | map_values({ (.key) : ("$" + .key) }) | reduce .[] as $item ({}; . + $item)' ./src/config.json > ./src/config.tmp.json && mv ./src/config.tmp.json ./src/config.json
RUN npm install && npm run build

FROM nginx:1.17
# Angular
# ENV JSFOLDER=/usr/share/nginx/html/*.js
# React
# ENV JSFOLDER=/usr/share/nginx/html/static/js/*.js
# VueJS 
# ENV JSFOLDER=/usr/share/nginx/html/js/*.js
COPY ./start-nginx.sh /usr/bin/start-nginx.sh
RUN chmod +x /usr/bin/start-nginx.sh
WORKDIR /usr/share/nginx/html
# Angular
# COPY --from=0 /app/dist/<projectName> .
# React
# COPY --from=0 /app/build .
# VueJS
# COPY --from=0 /app/dist .
ENTRYPOINT [ "start-nginx.sh" ]
```

You are now ready to rebuild your image and start that server again, but this time with environment variables. Open up your browser at [http://localhost:8080](http://localhost:8080) again, and you should now see the application running with the values of the environment variables passed to Docker.

```
docker build -t frontend .
docker run -d -p 8080:80 --rm --name front -e ENV=prod -e BASE_URL=/api frontend
```

## Summary
In short, here are the steps to make your environment variables accessible in your front-end container.

* Add a [config.json](https://github.com/joellord/frontend-containers/blob/main/config.json) file in your /src folder.
* Add the [start-nginx.sh](https://github.com/joellord/frontend-containers/blob/main/start-nginx.sh) bash script to your project
* Use the following [Dockerfile](https://github.com/joellord/frontend-containers/blob/main/Dockerfile) to build your project
* Start your container using -e to specify the environment variables.

Now that you've got all of this, you can reuse that same Dockerfile for any of your JavaScript projects. All the variables in the config.json are automatically changed, and you don't need to think about it anymore. 

You can find all the source code and examples for all three major front-end frameworks (Angular, React, Vue) on [Github](https://github.com/joellord/frontend-containers).
