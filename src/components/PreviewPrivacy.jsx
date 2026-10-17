import React, { createContext, useContext } from 'react';
import { displayIdentityText } from '../services/preview-privacy.js';

export const PreviewPrivacyContext = createContext(false);
export const IdentityNamesContext = createContext({});
export const usePreviewText = () => {
  const preview = useContext(PreviewPrivacyContext);
  const names = useContext(IdentityNamesContext);
  return value => displayIdentityText(value, preview, names);
};
