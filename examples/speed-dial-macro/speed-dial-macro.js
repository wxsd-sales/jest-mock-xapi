import xapi from "xapi";

const panelId = "speed-dial-panel";
const number = "number@example.com";

const panel = `
<Extensions>
  <Panel>
    <Location>HomeScreen</Location>
    <Icon>Input</Icon>
    <Name>Button</Name>
    <ActivityType>Custom</ActivityType>
  </Panel>
</Extensions>`;

xapi.Command.UserInterface.Extensions.Panel.Save({ PanelId: panelId }, panel);

xapi.Event.UserInterface.Extensions.Panel.Clicked.on(({ PanelId }) => {
  if (PanelId !== panelId) return;
  xapi.Command.Dial({ Number: number });
});
