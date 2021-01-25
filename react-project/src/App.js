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
