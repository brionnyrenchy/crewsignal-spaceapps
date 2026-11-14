import React from 'react';
import { registerRootComponent } from 'expo';
import App from './src/App';

function RootApp(): React.ReactElement {
  return React.createElement(App);
}

registerRootComponent(RootApp);
