import React from 'react';
import FolderTree from 'react-folder-tree';
import 'react-folder-tree/dist/style.css';

type Props = {
  files: { [path: string]: string },
};

const FileTree = (props: Props) => {
  const onTreeStateChange = (state, event) => console.log(state, event);

  return <FolderTree data={props.files} onChange={onTreeStateChange} />;
};

export default FileTree;
