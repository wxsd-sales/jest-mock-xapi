import xapi from "../../xapi.ts";

const macroName = _main_module_name();

xapi.Command.Macros.Macro.Deactivate({ Name: macroName });

export { macroName };
