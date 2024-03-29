import {YourGlobalConfig} from './types';
import {PluginInterface, PluginParams} from '../types/interface';

export const MyCustomPlugin = (
  globalConfig: YourGlobalConfig
): PluginInterface => {
  const metadata = {
    kind: 'execute',
  };

  /**
   * Execute's strategy description here.
   */
  const execute = async (inputs: PluginParams[]): Promise<PluginParams[]> => {
    return inputs.map(input => {
      // your logic here
      globalConfig;

      return input;
    });
  };

  return {
    metadata,
    execute,
  };
};
