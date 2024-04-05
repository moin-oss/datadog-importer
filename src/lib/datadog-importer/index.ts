import {YourGlobalConfig as DatadogImporterGlobalConfig} from './types';
import {
  DatadogImporterInterface,
  DatadogImporterParams,
} from '../types/interface';
import {client, v1} from '@datadog/datadog-api-client';

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
    inputs: DatadogImporterParams[],
    config?: Record<string, any>
  ): Promise<DatadogImporterParams[]> => {
    const configuration = client.createConfiguration();
    const apiInstance = new v1.MetricsApi(configuration);

    let outputs: DatadogImporterParams[] = [];

    // TODO validate config
    // TODO move some stuff to global config
    if (globalConfig === undefined) {
      console.log('Global Config is required');
      return inputs;
    }
    const instanceIdTag = globalConfig['instance-id-tag'];
    const locationTag = globalConfig['location-tag'];
    const instanceTypeTag = globalConfig['instance-type-tag'];
    const cpuUtilizationMetricName =
      globalConfig['cpu-utilization-metric-name'];

    config;

    for await (const input of inputs) {
      // TODO time step as config
      const start = new Date(input.timestamp);
      const startUnixTime: number = Math.round(start.getTime() / 1000);
      console.log(start.toISOString());

      const params: v1.MetricsApiQueryMetricsRequest = {
        from: startUnixTime,
        to: startUnixTime + input.duration,
        query: `avg:${cpuUtilizationMetricName}{${instanceIdTag}:${input['instance-id']}}by{${instanceTypeTag},${locationTag}}`,
      };

      const data = (await apiInstance
        .queryMetrics(params)
        .then((data: v1.MetricsQueryResponse) => {
          return data;
        })
        .catch((error: any) => {
          console.error(error);
        })) as v1.MetricsQueryResponse;

      // TODO average over time series
      // TODO handle multiple series
      const series = data.series || [];
      if (series.length === 0) {
        console.log('Series not found');
        continue;
      }

      const pointlist = series[0].pointlist || [];
      if (pointlist.length === 0) {
        console.log('Points not found');
        continue;
      }
      const point = pointlist[0];
      const value = point[1];

      const parseTag = (tag: string, tagSet: string[]) => {
        for (const pair of tagSet) {
          const [key, value] = pair.split(':', 2);
          if (key === tag) {
            return value;
          }
        }
        return '';
      };

      const tags = series[0].tagSet || [];

      const output = {
        ...input,
        'cpu/utilization': value,
        location: parseTag(locationTag, tags),
        'cloud/instance-type': parseTag(instanceTypeTag, tags),
      };

      outputs = [...outputs, output];
    }

    return outputs;
  };

  return {
    metadata,
    execute,
  };
};
