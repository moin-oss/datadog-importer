export type DatadogImporterParams = Record<string, any>;

export type DatadogImporterInterface = {
  execute: (
    inputs: DatadogImporterParams[],
    config?: Record<string, any>
  ) => Promise<DatadogImporterParams[]>;
  metadata: {
    kind: string;
  };
  [key: string]: any;
};
