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
    const metrics: string = globalConfig['metrics'];
    const outputMetricNames: string = globalConfig['output-metric-names'];

    config;

    const metricList = metrics.split(',');
    const outputMetricNameList = outputMetricNames.split(',');

    if (metricList.length !== outputMetricNameList.length) {
      console.error(
        'Input Validation Error: metrics and output-metric-names length must be equal.'
      );
      return inputs;
    }

    if (hasDuplicates(outputMetricNameList)) {
      console.error(
        'Input Validation Error: output-metric-names contains duplicate values.'
      );
      return inputs;
    }

    if (!(await determineIfMetricsExist(apiInstance, metricList))) {
      return inputs;
    }

    for await (const input of inputs) {
      // TODO time step as config
      const start = new Date(input.timestamp);
      const startUnixTime: number = Math.round(start.getTime() / 1000);
      console.log(start.toISOString());

      for (let i = 0; i < metricList.length; i++) {
        const metric = metricList[i];
        const outputMetricName = outputMetricNameList[i];

        const params: v1.MetricsApiQueryMetricsRequest = {
          from: startUnixTime,
          to: startUnixTime + input.duration,
          query: `avg:${metric}{${instanceIdTag}:${input['instance-id']}}by{${instanceTypeTag},${locationTag}}.rollup(${input['duration-rollup']})`,
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

        const tags = series[0].tagSet || [];

        const pointlist = series[0].pointlist || [];
        if (pointlist.length === 0) {
          console.log('Points not found');
          continue;
        }

        for (let j = 0; j < pointlist.length; j++) {
          const point = pointlist[j];
          let nextTimeStamp;
          if (j === pointlist.length - 1) {
            nextTimeStamp =
              new Date(input.timestamp).getTime() + input.duration * 1000;
          } else {
            nextTimeStamp = pointlist[j + 1][0];
          }
          const timestamp = point[0];
          const value = point[1];

          let output: DatadogImporterParams;
          if (i === 0) {
            output = {
              ...input,
              timestamp: new Date(timestamp).toISOString(),
              duration: (nextTimeStamp - timestamp) / 1000,
              location: parseTag(locationTag, tags),
              'cloud/instance-type': parseTag(instanceTypeTag, tags),
            };
          } else {
            output = outputs[j];
          }

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

          if (i === 0) {
            outputs = [...outputs, output];
          }
        }
      }
    }

    return outputs;
  };

  /**
   * Calls Datadog to determine if metrics exist
   * @param apiInstance Datadog metrics api instance
   * @param metrics metric names in question
   * @returns true if all metrics exist, false if not or could not be determined
   */
  async function determineIfMetricsExist(
    apiInstance: v1.MetricsApi,
    metrics: string[]
  ): Promise<boolean> {
    for (const metric of metrics) {
      const params: v1.MetricsApiGetMetricMetadataRequest = {
        metricName: metric,
      };

      try {
        // If the request is successful, the metric exists
        await apiInstance.getMetricMetadata(params);
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
    return true;
  }

  function parseTag(tag: string, tagSet: string[]) {
    for (const pair of tagSet) {
      const [key, value] = pair.split(':', 2);
      if (key === tag) {
        return value;
      }
    }
    return '';
  }

  function hasDuplicates(array: string[]) {
    return new Set(array).size !== array.length;
  }

  return {
    metadata,
    execute,
  };
};
