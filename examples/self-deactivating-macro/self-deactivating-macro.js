import xapi from "xapi";

const macroName = _main_module_name();

xapi.Command.Macros.Macro.Deactivate({ Name: macroName });
