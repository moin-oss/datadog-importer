import {YourGlobalConfig as DatadogImporterGlobalConfig} from './types';
import {
  DatadogImporterInterface,
  DatadogImporterParams,
} from '../types/interface';

export const DatadogImporter = (
  globalConfig: DatadogImporterGlobalConfig
): DatadogImporterInterface => {
  const metadata = {
    kind: 'execute',
  };

  /**
   * Execute's strategy description here.
   */
  const execute = async (
    inputs: DatadogImporterParams[]
  ): Promise<DatadogImporterParams[]> => {
    return inputs.map(input => {
      // your logic here
      globalConfig;
      console.log('hello');
      console.log(input);

      return input;
    });
  };

  return {
    metadata,
    execute,
  };
};
