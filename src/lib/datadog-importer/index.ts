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

    const rawQuery: string = config['raw-query'];
    const outputMetricName: string = config['output-metric-name'];

    if (!rawQuery) {
      errors.push('raw-query is required.');
    }

    if (!outputMetricName) {
      errors.push('output-metric-name is required.');
    }

    const aggregationTags: string = config['aggregation-tags'];
    const aggregationTagOutputNames: string =
      config['aggregation-tag-output-names'];
    const aggregationTagList = aggregationTags
      ? aggregationTags.split(',')
      : [];
    const aggregationTagOutputNamesList = aggregationTagOutputNames
      ? aggregationTagOutputNames.split(',')
      : [];

    if (aggregationTagList.length !== aggregationTagOutputNamesList.length) {
      errors.push(
        'aggregation-tags and aggregation-tag-output-names length must be equal.'
      );
    }

    if (hasDuplicates(aggregationTagOutputNamesList)) {
      errors.push('aggregation-tag-output-names contains duplicate values.');
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

    const outputMetricName: string = config['output-metric-name'];
    const aggregationTags: string = config['aggregation-tags'];
    const aggregationTagOutputNames: string =
      config['aggregation-tag-output-names'];

    const configuration = client.createConfiguration();
    const apiInstance = new v1.MetricsApi(configuration);

    for await (const input of inputs) {
      const start = new Date(input.timestamp);
      const startUnixTime: number = Math.round(start.getTime() / 1000);

      const processedQuery = processRawQuery(rawQuery, input, config);

      console.debug('Query with placeholders replaced: ', processedQuery);

      const queryResult = await executeDatadogQuery(
        apiInstance,
        processedQuery,
        startUnixTime,
        startUnixTime + input.duration
      );

      if (queryResult) {
        const processedOutputs = processQueryResult(
          queryResult,
          input,
          outputMetricName,
          aggregationTags,
          aggregationTagOutputNames
        );
        outputs = [...outputs, ...processedOutputs];
      }
    }

    return outputs;
  },
});

/**
 * Processes raw query by replacing placeholders with actual values
 * Supports nested placeholders that can reference other input values
 */
const processRawQuery = (
  rawQuery: string,
  input: PluginParams,
  config: ConfigParams
): string => {
  // Find all placeholders in the format <placeholder_name>
  const placeholderRegex = /<([^<>]+)>/g;
  let processedText = rawQuery;

  // Replace all placeholders with their corresponding input values
  processedText = processedText.replace(
    placeholderRegex,
    (match, placeholderName) => {
      if (placeholderName in input) {
        // Check if the placeholder exists in the input
        return String(input[placeholderName]);
      } else if (placeholderName in config) {
        // Check if the placeholder exists in the config
        return String(config[placeholderName]);
      } else {
        console.warn(
          `Placeholder "${placeholderName}" not found in input values nor config values`
        );
        return match;
      }
    }
  );

  return processedText;
};

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
  outputMetricName: string,
  aggregationTags: string,
  aggregationTagOutputNames: string
): DatadogImporterParams[] => {
  const outputs: DatadogImporterParams[] = [];
  const series = data.series || [];

  if (series.length === 0) {
    console.log('Series not found');
    return outputs;
  }

  const aggregationTagList = aggregationTags ? aggregationTags.split(',') : [];
  const outputAggregationTagNamesList = aggregationTagOutputNames
    ? aggregationTagOutputNames.split(',')
    : [];

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
      aggregationTagList.forEach((aggregationTag, k) => {
        if (k < outputAggregationTagNamesList.length) {
          output[outputAggregationTagNamesList[k]] = parseTag(
            aggregationTag,
            returnedTags
          );
        }
      });

      // Add metric value
      if (outputMetricName in output) {
        console.error(
          `output-metric-name "${outputMetricName}" is set to a reserved key. It cannot be any of the following: ${Object.keys(
            output
          )}`
        );
      } else {
        output[outputMetricName] = value;
      }

      outputs.push(output);
    }
  }

  return outputs;
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
