import {DatadogImporterParams} from '../types/interface';
import {client, v1} from '@datadog/datadog-api-client';
import {ApiException} from '@datadog/datadog-api-client/dist/packages/datadog-api-client-common';

import {PluginFactory} from '@grnsft/if-core/interfaces';
import {ConfigParams, PluginParams} from '@grnsft/if-core/types';
import {ERRORS} from '@grnsft/if-core/utils';

const {ConfigError} = ERRORS;

export const DatadogImporter = PluginFactory({
  configValidation: (config: ConfigParams) => {
    if (!config) {
      throw new ConfigError('Config is not provided.');
    }

    const errors: string[] = [];

    const tags: string = config['tags'];
    const outputTagNames: string = config['output-tag-names'];
    const tagList = tags ? tags.split(',') : [];
    const outputTagNamesList = outputTagNames ? outputTagNames.split(',') : [];

    // tags and output-tag-names validation
    if (tagList.length !== outputTagNamesList.length) {
      errors.push('Tags and output-tag-names length must be equal.');
    }

    if (hasDuplicates(outputTagNamesList)) {
      errors.push('output-tag-names contains duplicate values.');
    }

    // Raw query specific config
    const rawQuery: string = config['raw-query'];
    if (rawQuery) {
      // output-metric-names must be provided and must contain exactly one item
      const outputMetricNames: string = config['output-metric-names'];
      if (!outputMetricNames) {
        errors.push('output-metric-names is required when using raw-query.');
      } else {
        const outputMetricNameList = outputMetricNames.split(',');
        if (outputMetricNameList.length !== 1) {
          errors.push(
            'output-metric-names must contain exactly one item when using raw-query.'
          );
        }
      }
    } else {
      const metrics: string = config['metrics'];
      const outputMetricNames: string = config['output-metric-names'];

      if (!metrics || !outputMetricNames) {
        errors.push(
          'Metrics and output-metric-names are required for templated query.'
        );
      } else {
        const metricList = metrics.split(',');
        const outputMetricNameList = outputMetricNames.split(',');

        if (metricList.length !== outputMetricNameList.length) {
          errors.push(
            'Metrics and output-metric-names length must be equal for templated query.'
          );
        }

        if (hasDuplicates(outputMetricNameList)) {
          errors.push('Output-metric-names contains duplicate values.');
        }
      }
    }

    if (errors.length > 0) {
      throw new ConfigError(errors.join(' '));
    }

    return config;
  },
  inputValidation: (input: PluginParams) => {
    // do input validation here or pass zod schema

    return input;
  },
  implementation: async (inputs: PluginParams[], config: ConfigParams) => {
    let outputs: DatadogImporterParams[] = [];

    const rawQuery: string = config['raw-query'];
    const isRawQueryMode = !!rawQuery;

    const outputMetricNames: string = config['output-metric-names'];
    const tags: string = config['tags'];
    const outputTagNames: string = config['output-tag-names'];
    let identifierTag = '';
    let metrics = '';

    if (!isRawQueryMode) {
      identifierTag = config['id-tag'];
      metrics = config['metrics'];
    }

    const configuration = client.createConfiguration();
    const apiInstance = new v1.MetricsApi(configuration);

    // If using the templated query, validate individual metrics
    if (!isRawQueryMode) {
      const metricList = metrics.split(',');
      await determineIfMetricsExist(apiInstance, metricList);
    }

    for await (const input of inputs) {
      const start = new Date(input.timestamp);
      const startUnixTime: number = Math.round(start.getTime() / 1000);

      if (isRawQueryMode) {
        // Use raw query mode
        const queryResult = await executeDatadogQuery(
          apiInstance,
          rawQuery,
          startUnixTime,
          startUnixTime + input.duration
        );

        if (queryResult) {
          const processedOutputs = processQueryResult(
            queryResult,
            input,
            [outputMetricNames],
            tags,
            outputTagNames
          );
          outputs = [...outputs, ...processedOutputs];
        }
      } else {
        // Use templated query mode
        const metricList = metrics.split(',');
        const outputMetricNameList = outputMetricNames.split(',');

        for (let i = 0; i < metricList.length; i++) {
          const metric = metricList[i];
          const outputMetricName = outputMetricNameList[i];

          const query = buildQuery(input, metric, identifierTag, tags);

          const queryResult = await executeDatadogQuery(
            apiInstance,
            query,
            startUnixTime,
            startUnixTime + input.duration
          );

          if (queryResult) {
            if (i === 0) {
              // First metric creates new outputs
              const processedOutputs = processQueryResult(
                queryResult,
                input,
                [outputMetricName],
                tags,
                outputTagNames
              );
              outputs = [...outputs, ...processedOutputs];
            } else {
              // Subsequent metrics add to existing outputs
              addMetricToExistingOutputs(
                queryResult,
                outputs,
                outputMetricName
              );
            }
          }
        }
      }
    }

    return outputs;
  },
});

/**
 * Executes a Datadog query and returns the response
 */
const executeDatadogQuery = async (
  apiInstance: v1.MetricsApi,
  query: string,
  from: number,
  to: number
): Promise<v1.MetricsQueryResponse | null> => {
  const params: v1.MetricsApiQueryMetricsRequest = {
    from,
    to,
    query,
  };

  try {
    return await apiInstance.queryMetrics(params);
  } catch (error: any) {
    console.error(`Error executing query "${query}":`, error);
    if (error instanceof ApiException) {
      console.error(
        `Datadog API error: ${error.code} - ${error.body?.errors?.join(', ') || error.message}`
      );
    }
    return null;
  }
};

/**
 * Processes query result and creates output objects
 */
const processQueryResult = (
  data: v1.MetricsQueryResponse,
  input: PluginParams,
  outputMetricNames: string[],
  tags: string,
  outputTagNames: string
): DatadogImporterParams[] => {
  const outputs: DatadogImporterParams[] = [];
  const series = data.series || [];

  if (series.length === 0) {
    console.log('Series not found');
    return outputs;
  }

  const tagList = tags ? tags.split(',') : [];
  const outputTagNamesList = outputTagNames ? outputTagNames.split(',') : [];

  for (const s of series) {
    const returnedTags = s.tagSet || [];
    const pointlist = s.pointlist || [];

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

      const output: DatadogImporterParams = {
        ...input,
        timestamp: new Date(timestamp).toISOString(),
        duration: (nextTimeStamp - timestamp) / 1000,
      };

      // Add tags if configured
      tagList.forEach((tag, k) => {
        if (k < outputTagNamesList.length) {
          output[outputTagNamesList[k]] = parseTag(tag, returnedTags);
        }
      });

      // Add metric value(s)
      outputMetricNames.forEach(outputMetricName => {
        if (outputMetricName in output) {
          console.error(
            `output-metric-name "${outputMetricName}" is set to a reserved key. It cannot be any of the following: ${Object.keys(
              output
            )}`
          );
        } else {
          output[outputMetricName] = value;
        }
      });

      outputs.push(output);
    }
  }

  return outputs;
};

/**
 * Adds metric values to existing output objects (for multi-metric queries)
 */
const addMetricToExistingOutputs = (
  data: v1.MetricsQueryResponse,
  existingOutputs: DatadogImporterParams[],
  outputMetricName: string
): void => {
  const series = data.series || [];

  if (series.length === 0) {
    console.log('Series not found');
    return;
  }

  for (const s of series) {
    const pointlist = s.pointlist || [];

    if (pointlist.length === 0) {
      console.log('Points not found');
      continue;
    }

    for (let j = 0; j < pointlist.length && j < existingOutputs.length; j++) {
      const point = pointlist[j];
      const value = point[1];
      const output = existingOutputs[j];

      if (outputMetricName in output) {
        console.error(
          `output-metric-name "${outputMetricName}" is set to a reserved key. It cannot be any of the following: ${Object.keys(
            output
          )}`
        );
      } else {
        output[outputMetricName] = value;
      }
    }
  }
};

/**
 * Calls Datadog to determine if metrics exist
 * @param apiInstance Datadog metrics api instance
 * @param metrics metric names in question
 * @returns true if all metrics exist, false if not or could not be determined
 */
const determineIfMetricsExist = async (
  apiInstance: v1.MetricsApi,
  metrics: string[]
): Promise<boolean> => {
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
          throw new ConfigError(`Metric ${metric} does not exist`);
        } else {
          throw new ConfigError(
            `Error determining if metric ${metric} exists: ${error.body.errors.join(
              ', '
            )}`
          );
        }
      } else {
        throw new ConfigError(
          `Unexpected error determining if metric ${metric} exists: ${error}`
        );
      }
    }
  }
  return true;
};

const parseTag = (tag: string, tagSet: string[]) => {
  for (const pair of tagSet) {
    const [key, value] = pair.split(':', 2);
    if (key === tag) {
      return value;
    }
  }
  return '';
};

const hasDuplicates = (array: string[]) => {
  return new Set(array).size !== array.length;
};

const buildQuery = (
  input: PluginParams,
  metric: string,
  identifierTag: string,
  tags: string
): string => {
  let query = `avg:${metric}{${identifierTag}:${input['id']}}`;

  if (tags && tags.trim() !== '') {
    query += `by{${tags}}`;
  }

  const durationRollup = input['duration-rollup'];
  if (durationRollup !== null && durationRollup !== undefined) {
    query += `.rollup(${durationRollup})`;
  }

  return query;
};
