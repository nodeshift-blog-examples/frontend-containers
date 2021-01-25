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