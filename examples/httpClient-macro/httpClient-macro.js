import xapi from "xapi";

const panelId = "http-client-panel";
const requestUrl = "https://example.test/status";

let requestQueue = Promise.resolve();

const panel = `
<Extensions>
  <Panel>
    <Location>HomeScreen</Location>
    <Icon>Info</Icon>
    <Name>HTTP Client</Name>
    <ActivityType>Custom</ActivityType>
  </Panel>
</Extensions>`;

async function setup() {
  await xapi.Config.HttpClient.Mode.set("On");
  await xapi.Config.HttpClient.AllowHTTP.set("False");
  await xapi.Command.UserInterface.Extensions.Panel.Save({ PanelId: panelId }, panel);

  xapi.Event.UserInterface.Extensions.Panel.Clicked.on(({ PanelId }) => {
    if (PanelId !== panelId) return;
    queueStatusRequest();
  });
}

function queueStatusRequest() {
  requestQueue = requestQueue
    .catch(() => undefined)
    .then(() => runStatusRequest());

  return requestQueue;
}

async function runStatusRequest() {
  try {
    const result = await xapi.Command.HttpClient.Get({
      ResultBody: "PlainText",
      Url: requestUrl,
    });

    await xapi.Command.UserInterface.Message.Alert.Display({
      Text: `HTTP ${result.StatusCode}: ${result.Body}`,
      Title: "HTTP Client",
    });
  } catch (error) {
    await xapi.Command.UserInterface.Message.Alert.Display({
      Text: formatHttpError(error),
      Title: "HTTP Error",
    });
  }
}

function formatHttpError(error) {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const statusCode = error.data?.StatusCode;
  const statusText = statusCode ? ` (${statusCode})` : "";

  return `${error.message ?? "Unknown error"}${statusText}`;
}

export function waitForHttpQueue() {
  return requestQueue;
}

export const ready = setup();
