import {YourGlobalConfig as DatadogImporterGlobalConfig} from './types';
import {
  DatadogImporterInterface,
  DatadogImporterParams,
} from '../types/interface';
import { client, v1 } from "@datadog/datadog-api-client";

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
    const configuration = client.createConfiguration();
    const apiInstance = new v1.MetricsApi(configuration);
    
    return inputs.map(input => {
      // your logic here
      globalConfig;

      const start = new Date(input.timestamp);
      const startUnixTime: number = Math.round(start.getTime() / 1000);
      console.log(start.toISOString());

      const params: v1.MetricsApiQueryMetricsRequest = {
        from: startUnixTime,
        to: startUnixTime + input.duration,
        query: "avg:system.cpu.idle{*}",
      };

      apiInstance
        .queryMetrics(params)
        .then((data: v1.MetricsQueryResponse) => {
          console.log(
            "API called successfully. Returned data: " + JSON.stringify(data)
          );
          // For now, take the first point in the series. Later do an average
          // const series: v1.MetricsQueryMetadata? = data.series?[0] : null;
          // const point: [number, number]? = series?.pointlist?[0];
          
          // console.log(data.series?[0].pointlist?[0][0]);
          console.log()
          return {...input, data};
      })
      .catch((error: any) => {
        console.error(error)
      });

      return input
    });
  };

  return {
    metadata,
    execute,
  };
};
