<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<svelte:head>
  <title>Mérimée — monuments historiques</title>
</svelte:head>

{@render children()}
