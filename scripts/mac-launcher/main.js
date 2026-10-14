// The desktop applet: run the launch script, show any problem in a dialog.
// build.sh replaces __LAUNCH_SCRIPT__ with the absolute path of launch.sh.
const app = Application.currentApplication();
app.includeStandardAdditions = true;

const launchScript = "__LAUNCH_SCRIPT__";
const quoted = "'" + launchScript.split("'").join("'\\''") + "'";

try {
  app.doShellScript("/bin/zsh " + quoted);
} catch (error) {
  app.displayDialog(String(error.message || error), {
    withTitle: "人物小镇",
    buttons: ["好"],
    defaultButton: "好",
    withIcon: "stop",
  });
} finally {
  app.quit();
}
