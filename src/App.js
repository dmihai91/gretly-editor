/* eslint-disable react-native/no-inline-styles */
/* @flow */

import 'babel-polyfill';
import * as React from 'react';
import dedent from 'dedent';
import Editor from './components/Editor';
import './App.css';

type State = {
  files: {
    [name: string]: string
  },
  current: string,
  theme: 'ayu-light' | 'ayu-dark',
  mode: 'vue' | 'react'
};

const files = {
  'App.js': dedent`
  import Vue, { Component } from 'vue-class-component';

  @Component
  export class App extends Vue {
    render() {
      <div></div>
    }
  }
  `
};

export default class App extends React.Component<{}, State> {
  state = {
    files,
    current: 'App.js',
    theme: 'ayu-light',
    mode: 'vue'
  };

  _handleValueChange = code =>
    this.setState(state => ({
      files: {
        ...state.files,
        [state.current]: code
      }
    }));

  _handleOpenPath = (path: string) => this.setState({ current: path });

  changeTheme = (event: any) => {
    const value: string = (event.target: HTMLInputElement).value;
    const theme = value === 'light' ? 'ayu-light' : 'ayu-dark';
    this.setState({ theme });
  };

  changeMode = () => {
    /*const value: string = (event.target: HTMLInputElement).value;
    const mode = value;
    //this.setState({ mode });*/
  };
  render() {
    return (
      <div className="editor-container">
        <div className="editor-header-bar">
          <label className="selector-label">Editor theme: </label>
          <select id="theme" onChange={this.changeTheme} className="selector">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <label className="selector-label">Mode: </label>
          <select id="mode" onChange={this.changeMode} className="selector">
            <option value="vue">Vue</option>
            <option value="react">React</option>
          </select>
        </div>
        <div
          style={{
            display: 'flex',
            height: '100%',
            width: '100vw',
            minHeight: 'calc(100vh - 39px)',
            fontFamily: 'sans-serif'
          }}
        >
          <div
            style={{ width: 180, borderRight: '1px solid rgba(0, 0, 0, .08)' }}
          >
            {Object.keys(this.state.files).map(name => (
              <div
                key={name}
                style={{
                  fontSize: 14,
                  padding: '8px 24px',
                  backgroundColor:
                    this.state.current === name ? 'black' : 'transparent',
                  color: this.state.current === name ? 'white' : 'black',
                  cursor: 'pointer'
                }}
                onClick={() => this._handleOpenPath(name)}
              >
                {name}
              </div>
            ))}
          </div>

          <Editor
            files={this.state.files}
            path={this.state.current}
            value={this.state.files[this.state.current]}
            onOpenPath={this._handleOpenPath}
            onValueChange={this._handleValueChange}
            theme={this.state.theme}
          />
        </div>
      </div>
    );
  }
}
