export const defaultProductPlatform = "Desk Pro";
export const defaultSoftwareBuildId = "123456789";

export const defaultStatusEntries: Array<[string, unknown]> = [
  ["Status.Audio.Volume", "0"],
  ["Status.SystemUnit.ProductPlatform", defaultProductPlatform],
];

function getSchemaVersion(schemaName: string) {
  const version = schemaName.match(/^(\d+(?:\.\d+)*)/)?.[1] ?? "0.0.0";
  const versionParts = version.split(".");

  while (versionParts.length < 4) {
    versionParts.push("1");
  }

  return versionParts.join(".");
}

export function createSchemaSoftwareStatusEntries(
  schemaName: string,
): Array<[string, unknown]> {
  const softwareVersion = getSchemaVersion(schemaName);

  return [
    [
      "Status.SystemUnit.Software.DisplayName",
      `RoomOS ${softwareVersion} ${defaultSoftwareBuildId}`,
    ],
    [
      "Status.SystemUnit.Software.Version",
      `ce${softwareVersion}.${defaultSoftwareBuildId}`,
    ],
  ];
}
