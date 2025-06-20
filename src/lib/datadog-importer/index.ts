import {DatadogImporterParams} from '../types/interface';
import {client, v1} from '@datadog/datadog-api-client';
import {ApiException} from '@datadog/datadog-api-client/dist/packages/datadog-api-client-common';

import {PluginFactory} from '@grnsft/if-core/interfaces';
import {PluginParams, ConfigParams} from '@grnsft/if-core/types';
import {ERRORS} from '@grnsft/if-core/utils';

const {ConfigError} = ERRORS;

export const DatadogImporter = PluginFactory({
  configValidation: (config: ConfigParams) => {
    if (!config) {
      throw new ConfigError('Config is not provided.');
    }

    // If a raw query is provided, validate raw query specific config
    const rawQuery: string = config['raw-query'];
    if (rawQuery) {
      const outputMetricNames: string = config['output-metric-names'];
      if (!outputMetricNames) {
        throw new ConfigError(
          'output-metric-names is required when using raw-query.'
        );
      }

      const outputMetricNameList = outputMetricNames.split(',');
      if (outputMetricNameList.length !== 1) {
        throw new ConfigError(
          'output-metric-names must contain exactly one item when using raw-query.'
        );
      }

      // Validate optional tag configuration
      const tags: string = config['tags'];
      const outputTagNames: string = config['output-tag-names'];
      if (tags || outputTagNames) {
        const tagList = tags ? tags.split(',') : [];
        const outputTagNamesList = outputTagNames
          ? outputTagNames.split(',')
          : [];

        if (tagList.length !== outputTagNamesList.length) {
          throw new ConfigError(
            'Tags and output-tag-names length must be equal.'
          );
        }

        if (hasDuplicates(outputTagNamesList)) {
          throw new ConfigError('Output-tag-names contains duplicate values.');
        }
      }

      return config;
    }

    // Validate standard metric-based configuration
    const metrics: string = config['metrics'];
    const outputMetricNames: string = config['output-metric-names'];
    const tags: string = config['tags'];
    const outputTagNames: string = config['output-tag-names'];

    if (!metrics || !outputMetricNames) {
      throw new ConfigError(
        'Metrics and output-metric-names are required when raw-query is not provided.'
      );
    }

    const metricList = metrics.split(',');
    const outputMetricNameList = outputMetricNames.split(',');
    const tagList = tags ? tags.split(',') : [];
    const outputTagNamesList = outputTagNames ? outputTagNames.split(',') : [];

    if (metricList.length !== outputMetricNameList.length) {
      throw new ConfigError(
        'Metrics and output-metric-names length must be equal.'
      );
    }

    if (hasDuplicates(outputMetricNameList)) {
      throw new ConfigError('Output-metric-names contains duplicate values.');
    }

    if (tagList.length !== outputTagNamesList.length) {
      throw new ConfigError('Tags and output-tag-names length must be equal.');
    }

    if (hasDuplicates(outputTagNamesList)) {
      throw new ConfigError('Output-tag-names contains duplicate values.');
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
    const identifierTag: string = config['id-tag'];
    const metrics: string = config['metrics'];
    const outputMetricNames: string = config['output-metric-names'];
    const tags: string = config['tags'];
    const outputTagNames: string = config['output-tag-names'];

    const configuration = client.createConfiguration();
    const apiInstance = new v1.MetricsApi(configuration);

    // If using raw query, we can't validate individual metrics
    if (!rawQuery) {
      const metricList = metrics.split(',');
      await determineIfMetricsExist(apiInstance, metricList);
    }

    for await (const input of inputs) {
      const start = new Date(input.timestamp);
      const startUnixTime: number = Math.round(start.getTime() / 1000);

      if (rawQuery) {
        // Use raw query mode
        const outputMetricName = outputMetricNames;

        const params: v1.MetricsApiQueryMetricsRequest = {
          from: startUnixTime,
          to: startUnixTime + input.duration,
          query: rawQuery,
        };

        try {
          const data = await apiInstance.queryMetrics(params);

          const series = data.series || [];
          if (series.length === 0) {
            console.log('Series not found for raw query');
            continue;
          }

          for (const s of series) {
            const returnedTags = s.tagSet || [];
            const pointlist = s.pointlist || [];

            if (pointlist.length === 0) {
              console.log('Points not found for raw query');
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
                [outputMetricName]: value,
              };

              // Add tags if configured
              if (tags && outputTagNames) {
                const tagList = tags.split(',');
                const outputTagNamesList = outputTagNames.split(',');
                tagList.forEach((tag, k) => {
                  if (k < outputTagNamesList.length) {
                    output[outputTagNamesList[k]] = parseTag(tag, returnedTags);
                  }
                });
              }

              outputs = [...outputs, output];
            }
          }
        } catch (error: any) {
          console.error(`Error executing raw query "${rawQuery}":`, error);
          if (error instanceof ApiException) {
            console.error(
              `Datadog API error: ${error.code} - ${error.body?.errors?.join(', ') || error.message}`
            );
          }
          // Continue processing other inputs even if this one fails
          continue;
        }
      } else {
        // Use existing metric-based query mode
        const metricList = metrics.split(',');
        const outputMetricNameList = outputMetricNames.split(',');
        const tagList = tags ? tags.split(',') : [];
        const outputTagNamesList = outputTagNames
          ? outputTagNames.split(',')
          : [];

        for (let i = 0; i < metricList.length; i++) {
          const metric = metricList[i];
          const outputMetricName = outputMetricNameList[i];

          const query = buildQuery(input, metric, identifierTag, tags);
          const params: v1.MetricsApiQueryMetricsRequest = {
            from: startUnixTime,
            to: startUnixTime + input.duration,
            query: query,
          };

          const data = (await apiInstance
            .queryMetrics(params)
            .then((data: v1.MetricsQueryResponse) => {
              return data;
            })
            .catch((error: any) => {
              console.error(error);
            })) as v1.MetricsQueryResponse;

          const series = data.series || [];
          if (series.length === 0) {
            console.log('Series not found');
            continue;
          }

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

              let output: DatadogImporterParams;
              if (i === 0) {
                output = {
                  ...input,
                  timestamp: new Date(timestamp).toISOString(),
                  duration: (nextTimeStamp - timestamp) / 1000,
                };
                tagList.forEach((tag, k) => {
                  output[outputTagNamesList[k]] = parseTag(tag, returnedTags);
                });
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
      }
    }

    return outputs;
  },
});

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
