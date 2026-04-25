import xapi from "xapi";

const panelId = "monitor-role-changer";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function hasMonitorRole(output) {
  return (
    typeof output === "object" &&
    output !== null &&
    Object.hasOwn(output, "MonitorRole")
  );
}

function discoverMonitorRoleConnectors(outputs) {
  if (!Array.isArray(outputs)) {
    return [];
  }

  return outputs
    .map((output, index) => ({
      id: index + 1,
      output,
    }))
    .filter(({ output }) => hasMonitorRole(output));
}

function monitorRoleValuesFor(productName, connectorCount) {
  if (connectorCount === 3) {
    if (productName.startsWith("Board")) {
      return ["Auto", "First", "Second", "Third"];
    }

    return ["Auto", "First", "Second", "Third", "PresentationOnly"];
  }

  if (connectorCount === 2) {
    return ["Auto", "First", "Second"];
  }

  return ["Auto", "First"];
}

function createValueSpace(values) {
  return values
    .map(
      (value) => `
          <Value>
            <Key>${escapeXml(value)}</Key>
            <Name>${escapeXml(value)}</Name>
          </Value>`,
    )
    .join("");
}

function createConnectorRow(connector, values) {
  return `
      <Row>
        <Name>Output ${connector.id}</Name>
        <Widget>
          <WidgetId>${panelId}-${connector.id}</WidgetId>
          <Type>GroupButton</Type>
          <Options>size=4;columns=${values.length}</Options>
          <ValueSpace>${createValueSpace(values)}
          </ValueSpace>
        </Widget>
      </Row>`;
}

function createPanel(connectors, values) {
  const rows = connectors
    .map((connector) => createConnectorRow(connector, values))
    .join("");

  return `
<Extensions>
  <Panel>
    <Location>ControlPanel</Location>
    <Icon>Sliders</Icon>
    <Name>Monitor Roles</Name>
    <ActivityType>Custom</ActivityType>
    <Page>
      <Name>Outputs</Name>${rows}
    </Page>
  </Panel>
</Extensions>`;
}

function parseMonitorRoleWidgetId(widgetId) {
  if (typeof widgetId !== "string") {
    return null;
  }

  const connectorId = Number(widgetId.slice(panelId.length+1));

  return Number.isInteger(connectorId) ? connectorId : null;
}

async function main() {
  const productPlatform = await xapi.Status.SystemUnit.ProductPlatform.get();
  const productName =
    typeof productPlatform === "string" ? productPlatform : "";
  const outputs = await xapi.Config.Video.Output.Connector.get();

  const connectors = discoverMonitorRoleConnectors(outputs);

  if (connectors.length === 0) {
    console.log("No available output connector with monitor role");
    return;
  }

  const availableValues = monitorRoleValuesFor(productName, connectors.length);
  const connectorIds = connectors.map(({ id }) => id);
  const panel = createPanel(connectors, availableValues);

  await xapi.Command.UserInterface.Extensions.Panel.Save(
    { PanelId: panelId },
    panel,
  );

  xapi.Event.UserInterface.Extensions.Widget.Action.on(
    ({ WidgetId, Value }) => {
      if (typeof WidgetId !== "string" || !WidgetId.startsWith(panelId)) return;
      const connectorId = parseMonitorRoleWidgetId(WidgetId);

      if (
        connectorId === null ||
        !connectorIds.includes(connectorId) ||
        !availableValues.includes(Value)
      ) {
        return;
      }

      xapi.Config.Video.Output.Connector[connectorId].MonitorRole.set(Value);
    },
  );
}

await main();
