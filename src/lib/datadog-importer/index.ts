import {YourGlobalConfig as DatadogImporterGlobalConfig} from './types';
import {
  DatadogImporterInterface,
  DatadogImporterParams,
} from '../types/interface';
import {client, v1} from '@datadog/datadog-api-client';
import {ApiException} from '@datadog/datadog-api-client/dist/packages/datadog-api-client-common';

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
    const instanceIdTag: string = globalConfig['instance-id-tag'];
    const locationTag: string = globalConfig['location-tag'];
    const instanceTypeTag: string = globalConfig['instance-type-tag'];
    const metric: string = globalConfig['metric'];
    const outputMetricName: string = globalConfig['output-metric-name'];

    config;

    if (!(await determineIfMetricExists(apiInstance, metric))) {
      return inputs;
    }

    for await (const input of inputs) {
      // TODO time step as config
      const start = new Date(input.timestamp);
      const startUnixTime: number = Math.round(start.getTime() / 1000);
      console.log(start.toISOString());

      const params: v1.MetricsApiQueryMetricsRequest = {
        from: startUnixTime,
        to: startUnixTime + input.duration,
        query: `avg:${metric}{${instanceIdTag}:${input['instance-id']}}by{${instanceTypeTag},${locationTag}}`,
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

      const pointlist = series[0].pointlist || [];
      if (pointlist.length === 0) {
        console.log('Points not found');
        continue;
      }

      for (let i = 0; i < pointlist.length; i++) {
        const point = pointlist[i];
        let nextTimeStamp;
        if (i === pointlist.length - 1) {
          nextTimeStamp =
            new Date(input.timestamp).getTime() + input.duration * 1000;
        } else {
          nextTimeStamp = pointlist[i + 1][0];
        }
        const timestamp = point[0];
        const value = point[1];

        const output: OutputObject = {
          ...input,
          timestamp: new Date(timestamp).toISOString(),
          duration: (nextTimeStamp - timestamp) / 1000,
          location: parseTag(locationTag, tags),
          'cloud/instance-type': parseTag(instanceTypeTag, tags),
        };

        if (outputMetricName in output) {
          console.error(
            `output-metric-name "${outputMetricName}" is set to a reserved key. It cannot be any of the following: ${Object.keys(
              output
            )}`
          );
          break;
        } else {
          output[outputMetricName] = value;
        }

        outputs = [...outputs, output];
      }
    }

    return outputs;
  };

  /**
   * Calls Datadog to determine if metric exists
   * @param apiInstance Datadog metrics api instance
   * @param metric metric name in question
   * @returns true if metric exists, false if not or could not be determined
   */
  async function determineIfMetricExists(
    apiInstance: v1.MetricsApi,
    metric: string
  ): Promise<boolean> {
    const params: v1.MetricsApiGetMetricMetadataRequest = {
      metricName: metric,
    };

    try {
      await apiInstance.getMetricMetadata(params);
      return true; // If the request is successful, the metric exists
    } catch (error) {
      if (error instanceof ApiException) {
        if (error.code === 404) {
          console.error(`Metric ${metric} does not exist`);
        } else {
          console.error(
            `Error determining if metric ${metric} exists: ${error.body.errors.join(
              ', '
            )}`
          );
        }
      } else {
        console.error(
          `Unexpected error determining if metric ${metric} exists: ${error}`
        );
      }
      return false;
    }
  }

  interface OutputObject {
    [key: string]: any;
    timestamp: string;
    duration: number;
    location: string;
    'cloud/instance-type': string;
  }

  return {
    metadata,
    execute,
  };
};
