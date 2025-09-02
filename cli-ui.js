const { createTextBox } = require("./components/text-input");

module.exports = {
  showLauncher,
};

async function showLauncher() {
  return new Promise(async (resolve) => {
    let hasResolved = false;
    const ReactModule = await import("react");
    const React = ReactModule.default || ReactModule;
    const ink = await import("ink");
    const TextInputModule = await import("ink-text-input");
    const TextInput = TextInputModule.default || TextInputModule;

    const { render, Box, Text, useApp, useInput } = ink;
    const { useState, useMemo } = React;

    const BOX_WIDTH = 50;
    const WELCOME_WIDTH = 46;
    const horiz = "─".repeat(BOX_WIDTH);
    const welcomeHoriz = "─".repeat(WELCOME_WIDTH);
    const Art = [
      " ██████╗  ██████╗ ████████╗    ███████╗██╗   ██╗███╗   ███╗",
      " ██╔══██╗██╔═══██╗╚══██╔══╝    ██╔════╝██║   ██║████╗ ████║",
      " ██║  ██║██║   ██║   ██║       █████╗  ╚██╗ ██╔╝██╔████╔██║",
      " ██║  ██║██║   ██║   ██║       ██╔══╝   ╚████╔╝ ██║╚██╔╝██║",
      " ██████╔╝╚██████╔╝   ██║       ███████╗  ╚██╔╝  ██║ ╚═╝ ██║",
      " ╚═════╝  ╚═════╝    ╚═╝       ╚══════╝   ╚═╝   ╚═╝     ╚═╝",
    ];

    const App = ({ onSubmit }) => {
      const { exit } = useApp();
      useInput((input, key) => {
        if (key.return) {
          if (!hasResolved) {
            hasResolved = true;
            exit();
            onSubmit({ type: "startLogin" });
          }
        }
      });

      const artElements = useMemo(
        () =>
          Art.map((line, index) =>
            React.createElement(Text, { key: index, color: "red" }, line)
          ),
        []
      );

      return React.createElement(
        Box,
        { flexDirection: "column" },

        React.createElement(Text, { color: "red" }, `┌${welcomeHoriz}┐`),
        React.createElement(
          Box,
          { flexDirection: "row" },
          React.createElement(Text, { color: "red" }, "│"),
          React.createElement(
            Box,
            {
              width: WELCOME_WIDTH,
              justifyContent: "flex-start",
              alignItems: "center",
            },
            React.createElement(Text, { color: "red", size: 24 }, " ⚈ "),
            React.createElement(Text, { color: "white" }, "Welcome to "),
            React.createElement(
              Text,
              { color: "white", bold: true },
              "Environmental Variable Manager"
            )
          ),
          React.createElement(Text, { color: "red" }, "│")
        ),
        React.createElement(Text, { color: "red" }, `└${welcomeHoriz}┘`),

        React.createElement(
          Box,
          { marginTop: 1, flexDirection: "column" },
          artElements
        ),

        React.createElement(
          Box,
          { marginTop: 2, flexDirection: "column", alignItems: "left" },
          React.createElement(
            Text,
            { color: "white", marginTop: 1 },
            "Secure environment variable management for your projects"
          ),
          React.createElement(
            Text,
            { color: "gray" },
            "• Sync .env files across teams and environments -COMING SOON-"
          ),
          React.createElement(
            Text,
            { color: "gray" },
            "• Encrypted storage and secure access control"
          ),
          React.createElement(
            Text,
            { color: "gray" },
            "• Version control for environment configurations"
          ),
          React.createElement(
            Text,
            { color: "gray" },
            "• Seamless integration with your development workflow"
          )
        ),

        React.createElement(
          Box,
          { marginTop: 1, flexDirection: "row" ,alignItems: "left" },
          React.createElement(Text, { color: "white" }, "Press"),
          React.createElement(Text, { color: "red", bold: true }, " Enter"),
          React.createElement(Text, { color: "white" }, " to Login or Register")
        )
      );
    };

    const instance = render(
      React.createElement(App, {
        onSubmit: (data) => {
          resolve(data);
        },
      })
    );
  });
}
