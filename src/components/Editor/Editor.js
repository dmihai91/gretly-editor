/* eslint-disable react/sort-comp */
/* eslint-disable react-native/no-inline-styles */
/* eslint-disable react/no-deprecated */
/* eslint-disable import/default */
/* eslint-disable import/extensions */
/* @flow */

import * as React from 'react';
import debounce from 'lodash/debounce';

import * as monaco from 'monaco-editor/esm/vs/editor/editor.main';
import { SimpleEditorModelResolverService } from 'monaco-editor/esm/vs/editor/standalone/browser/simpleServices';
import { StaticServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices';

import TypingsWorker from '../../workers/typings.worker';
import ESLintWorker from '../../workers/eslint.worker';
import light from '../../themes/light';
import dark from '../../themes/dark';
import './Editor.css';

import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import MonacoJSXHighlighter from 'monaco-jsx-highlighter';

type Props = {
  files: { [path: string]: string },
  path: string,
  value: string,
  onOpenPath: (path: string) => mixed,
  onValueChange: (value: string) => mixed,
  lineNumbers?: 'on' | 'off',
  wordWrap: 'off' | 'on' | 'wordWrapColumn' | 'bounded',
  scrollBeyondLastLine?: boolean,
  minimap?: {
    enabled?: boolean,
    maxColumn?: number,
    renderCharacters?: boolean,
    showSlider?: 'always' | 'mouseover',
    side?: 'right' | 'left'
  },
  theme: 'ayu-light' | 'ayu-dark'
};

/**
 * Monkeypatch to make 'Find All References' work across multiple files
 * https://github.com/Microsoft/monaco-editor/issues/779#issuecomment-374258435
 */
SimpleEditorModelResolverService.prototype.findModel = function(
  editor,
  resource
) {
  return monaco.editor
    .getModels()
    .find(model => model.uri.toString() === resource.toString());
};

global.MonacoEnvironment = {
  getWorker(moduleId, label) {
    let MonacoWorker;

    switch (label) {
      case 'json':
        /* $FlowFixMe */
        MonacoWorker = require('worker-loader!monaco-editor/esm/vs/language/json/json.worker');
        break;
      case 'typescript':
      case 'javascript':
        /* $FlowFixMe */
        MonacoWorker = require('worker-loader!monaco-editor/esm/vs/language/typescript/ts.worker');
        break;
      default:
        /* $FlowFixMe */
        MonacoWorker = require('worker-loader!monaco-editor/esm/vs/editor/editor.worker');
    }

    return new MonacoWorker();
  }
};

monaco.editor.defineTheme('ayu-light', light);
monaco.editor.defineTheme('ayu-dark', dark);

/**
 * Disable typescript's diagnostics for JavaScript files.
 * This suppresses errors when using Flow syntax.
 * It's also unnecessary since we use ESLint for error checking.
 */
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: true
});

/**
 * Use prettier to format JavaScript code.
 * This will replace the default formatter.
 */
monaco.languages.registerDocumentFormattingEditProvider('javascript', {
  async provideDocumentFormattingEdits(model) {
    const prettier = await import('prettier/standalone');
    const babylon = await import('prettier/parser-babylon');
    const text = prettier.format(model.getValue(), {
      parser: 'babylon',
      plugins: [babylon],
      singleQuote: true
    });

    return [
      {
        range: model.getFullModelRange(),
        text
      }
    ];
  }
});

/**
 * Sync all the models to the worker eagerly.
 * This enables intelliSense for all files without needing an `addExtraLib` call.
 */
monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);

/**
 * Configure the typescript compiler to detect JSX and load type definitions
 */
const compilerOptions = {
  allowJs: true,
  allowSyntheticDefaultImports: true,
  alwaysStrict: true,
  jsx: 'React',
  jsxFactory: 'h'
};

monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
  compilerOptions
);

monaco.languages.typescript.javascriptDefaults.setCompilerOptions(
  compilerOptions
);

// Store editor states such as cursor position, selection and scroll position for each model
const editorStates = new Map();

// Store details about typings we have loaded
const extraLibs = new Map();

const codeEditorService = StaticServices.codeEditorService.get();

// Minimal Babel setup for React JSX parsing:
const babelParse = code =>
  parse(code, {
    sourceType: 'module',
    plugins: ['jsx']
  });

export default class Editor extends React.Component<Props> {
  static removePath(path: string) {
    // Remove editor states
    editorStates.delete(path);

    // Remove associated models
    const model = monaco.editor
      .getModels()
      .find(model => model.uri.path === path);

    model && model.dispose();
  }

  static renamePath(oldPath: string, newPath: string) {
    const selection = editorStates.get(oldPath);

    editorStates.delete(oldPath);
    editorStates.set(newPath, selection);

    this.removePath(oldPath);
  }

  static defaultProps = {
    lineNumbers: 'on',
    wordWrap: 'on',
    scrollBeyondLastLine: false,
    minimap: {
      enabled: false
    },
    theme: 'ayu-light'
  };

  componentDidMount() {
    // Intialize the linter
    this._linterWorker = new ESLintWorker();
    this._linterWorker.addEventListener('message', ({ data }: any) =>
      this._updateMarkers(data)
    );

    // Intialize the type definitions worker
    this._typingsWorker = new TypingsWorker();
    this._typingsWorker.addEventListener('message', ({ data }: any) =>
      this._addTypings(data)
    );

    // Fetch some definitions
    const dependencies = {
      expo: '29.0.0',
      react: '16.3.1',
      'react-native': '0.55.4',
      vue: '2.6.13',
      'vue-class-component': '7.2.6'
    };

    Object.keys(dependencies).forEach(name =>
      this._typingsWorker.postMessage({
        name,
        version: dependencies[name]
      })
    );

    const { path, value, ...rest } = this.props;

    this._editor = monaco.editor.create(this._node, rest, {
      codeEditorService: Object.assign(Object.create(codeEditorService), {
        openCodeEditor: async ({ resource, options }, editor) => {
          // Open the file with this path
          // This should set the model with the path and value
          this.props.onOpenPath(resource.path);

          // Move cursor to the desired position
          editor.setSelection(options.selection);

          // Scroll the editor to bring the desired line into focus
          editor.revealLine(options.selection.startLineNumber);

          return Promise.resolve({
            getControl: () => editor
          });
        }
      })
    });

    // set language mode to typescript
    const model = this._editor.getModel();
    monaco.editor.setModelLanguage(model, 'typescript');

    Object.keys(this.props.files).forEach(path =>
      this._initializeFile(path, this.props.files[path])
    );

    this._openFile(path, value);
    this._phantom.contentWindow.addEventListener('resize', this._handleResize);

    // Instantiate the highlighter
    const monacoJSXHighlighter = new MonacoJSXHighlighter(
      monaco,
      babelParse,
      traverse,
      this._editor
    );
    // Activate highlighting (debounceTime default: 100ms)
    monacoJSXHighlighter.highLightOnDidChangeModelContent(100);
    // Activate JSX commenting
    monacoJSXHighlighter.addJSXCommentCommand();
    // Done =)
  }

  componentDidUpdate(prevProps: Props) {
    const { path, value, ...rest } = this.props;

    this._editor.updateOptions(rest);

    if (path !== prevProps.path) {
      editorStates.set(prevProps.path, this._editor.saveViewState());

      this._openFile(path, value);
    } else if (value !== this._editor.getModel().getValue()) {
      const model = this._editor.getModel();

      if (value !== model.getValue()) {
        model.pushEditOperations(
          [],
          [
            {
              range: model.getFullModelRange(),
              text: value
            }
          ]
        );
      }
    }
  }
  componentWillUnmount() {
    this._linterWorker && this._linterWorker.terminate();
    this._typingsWorker && this._typingsWorker.terminate();
    this._subscription && this._subscription.dispose();
    this._editor && this._editor.dispose();
    this._phantom &&
      this._phantom.contentWindow.removeEventListener(
        'resize',
        this._handleResize
      );
  }

  clearSelection() {
    const selection = this._editor.getSelection();

    this._editor.setSelection(
      new monaco.Selection(
        selection.startLineNumber,
        selection.startColumn,
        selection.startLineNumber,
        selection.startColumn
      )
    );
  }

  _initializeFile = (path: string, value: string) => {
    let model = monaco.editor
      .getModels()
      .find(model => model.uri.path === path);

    if (model) {
      // If a model exists, we need to update it's value
      // This is needed because the content for the file might have been modified externally
      // Use `pushEditOperations` instead of `setValue` or `applyEdits` to preserve undo stack
      model.pushEditOperations(
        [],
        [
          {
            range: model.getFullModelRange(),
            text: value
          }
        ]
      );
    } else {
      model = monaco.editor.createModel(
        value,
        'javascript',
        new monaco.Uri().with({ path })
      );
      model.updateOptions({
        tabSize: 2,
        insertSpaces: true
      });
    }
  };

  _openFile = (path: string, value: string) => {
    this._initializeFile(path, value);

    const model = monaco.editor
      .getModels()
      .find(model => model.uri.path === path);

    this._editor.setModel(model);

    // Restore the editor state for the file
    const editorState = editorStates.get(path);

    if (editorState) {
      this._editor.restoreViewState(editorState);
    }

    this._editor.focus();

    // Subscribe to change in value so we can notify the parent
    this._subscription && this._subscription.dispose();
    this._subscription = this._editor.getModel().onDidChangeContent(() => {
      const value = this._editor.getModel().getValue();

      this.props.onValueChange(value);
      this._lintCode(value);
    });
  };

  _lintCode = code => {
    const model = this._editor.getModel();

    monaco.editor.setModelMarkers(model, 'eslint', []);

    this._linterWorker.postMessage({
      code,
      version: model.getVersionId()
    });
  };

  _addTypings = ({ typings }) => {
    Object.keys(typings).forEach(path => {
      let extraLib = extraLibs.get(path);

      extraLib && extraLib.dispose();
      extraLib = monaco.languages.typescript.javascriptDefaults.addExtraLib(
        typings[path],
        path
      );

      extraLibs.set(path, extraLib);
    });
  };

  _updateMarkers = ({ markers, version }: any) => {
    requestAnimationFrame(() => {
      const model = this._editor.getModel();

      if (model && model.getVersionId() === version) {
        monaco.editor.setModelMarkers(model, 'eslint', markers);
      }
    });
  };

  _handleResize = debounce(() => this._editor.layout(), 100, {
    leading: true,
    trailing: true
  });

  _linterWorker: Worker;
  _typingsWorker: Worker;
  _subscription: any;
  _editor: monaco.editor.IStandaloneCodeEditor;
  _phantom: any;
  _node: any;

  componentWillReceiveProps(nextProps: Props) {
    // watch if the theme change and set it in the editor
    const { theme } = this.props;
    if (nextProps.theme !== theme) {
      monaco.editor.setTheme(nextProps.theme);
    }
  }

  render() {
    return (
      <div
        style={{
          display: 'flex',
          flex: 1,
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <iframe
          ref={c => (this._phantom = c)}
          type="text/html"
          style={{
            display: 'block',
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: '100%',
            pointerEvents: 'none',
            opacity: 0
          }}
        />
        <div
          ref={c => (this._node = c)}
          style={{ display: 'flex', flex: 1, overflow: 'hidden' }}
          className={this.props.theme}
        />
      </div>
    );
  }
}
