# datadog-importer

The `datadog-importer` plugin fetches metrics from Datadog for use in Impact Framework calculations.

## Implementation

The `datadog-importer` plugin fetches metrics from Datadog using raw query strings and formats them for use in Impact Framework calculations. The plugin supports generic placeholder substitution, allowing dynamic queries based on input values and configuration parameters.

The plugin processes time-series data from Datadog and can output multiple data points based on the query results and time slicing.

## Usage

### Environment
To use the Datadog API, you must set these environment variables:
```
export DD_SITE=<site parameter>
export DD_APP_KEY=<secret>
export DD_API_KEY=<secret>
```
Choose the appropriate site parameter from [this list](https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site).
Refer to [this documentation](https://docs.datadoghq.com/account_management/api-app-keys/) on APP and API keys if needed.

### Config

The datadog-importer plugin uses raw Datadog query strings with support for generic placeholder substitution. Placeholders in the format `<placeholder_name>` are replaced with corresponding values from input parameters or configuration.

#### Global Configuration
* `raw-query`: **Required.** The raw Datadog query string to execute. Supports placeholders in the format `<placeholder_name>` that will be replaced with values from input parameters or config values.
* `output-metric-name`: **Required.** The name to use for the metric value in the output. Only one metric name is supported per query.
* `aggregation-tags`: **Optional.** Comma-separated list of tag names from the Datadog query result to include in the output.
* `aggregation-tag-output-names`: **Optional.** Comma-separated list of output names for the aggregation tags. Must have the same length as `aggregation-tags` if provided.

#### Placeholder Support
Placeholders in the `raw-query` are replaced in the following order:
1. Values from input parameters (e.g., `<id>`, `<timestamp>`, `<duration>`)
2. Values from configuration parameters
3. If no match is found, the placeholder is left unchanged and a warning is logged

Example placeholders:
- `<id>`: Replaced with the `id` value from input
- `<env>`: Replaced with an `env` value from config or input
- `<custom_tag>`: Replaced with any custom parameter from input or config

#### Node-level
There is no node-level configuration.

### Inputs
* `timestamp`: An ISO8601 timestamp indicating the start time of the observation period
* `duration`: Number of seconds in the observation period. We compute the end time by adding this number to `timestamp`
* `id`: A unique identifier for the unit represented by the input (can be used in query placeholders)
* Any additional parameters can be provided and used as placeholders in the raw query (e.g., `env`, `region`, `application`, etc.)

### Outputs
The plugin processes the Datadog query results and creates output objects based on the time-series data returned. Each data point in the time series becomes a separate output object.

Each output will have the following fields:
* `timestamp`: An ISO8601 timestamp indicating the start time of the data point
* `duration`: Number of seconds for the data point duration (calculated from the time series intervals)
* All original input parameters (preserved from the input)
* `<output-metric-name>`: The metric value from the query result, using the name specified in the `output-metric-name` configuration
* `<aggregation-tag-output-names>`: If configured, tag values from the query result using the names specified in `aggregation-tag-output-names`

### Grouping
The output of this plugin is a one dimensional array at the level of the input. If your output contains of multiple tag combinations, you may want to regroup on the tags. Grouping is a native functionality of the Impact Framework and is [documented here](https://if.greensoftware.foundation/major-concepts/manifest-file/#regrouping-a-manifest-file).

### Examples

#### Manifest
Consider the following input manifest file:
```yaml
name: datadog-importer-example
description: A sample manifest file demonstrating usage of the datadog-importer plugin with raw query
initialize:
  plugins:
    datadog-importer: 
      path: 'https://github.com/moin-oss/datadog-importer'
      method: DatadogImporter
      config:
        raw-query: 'exclude_null((sum:kubernetes.cpu.usage.total{env:<env>,project:<id>} by {kube_node_region}.rollup(3600) / 1000000000) / sum:kubernetes.cpu.requests{env:<env>,project:<id>} by {kube_node_region}.rollup(3600) * 100)'
        output-metric-name: 'cpu/utilization'
        aggregation-tags: 'kube_node_region'
        aggregation-tag-output-names: 'cloud/region'
        env: 'prod'
tree:
  children:
    my-app:
      pipeline:
        observe:
          - datadog-importer
      inputs:
        - timestamp: 2024-05-21T06:00
          duration: 14400
          id: my-app
```
In this scenario, we are collecting the CPU utilization of `my-app` over 4 hours starting at 6:00 AM UTC on May 21, 2024. The raw query uses placeholders:
- `<env>` is replaced with `prod` from the config
- `<id>` is replaced with `my-app` from the input

The query calculates CPU utilization as a percentage by dividing CPU usage by CPU requests, grouped by Kubernetes node region.

Assuming the Datadog query returns time-series data with multiple data points across different regions, the output will be (comments added for emphasis):
```yaml
tree:
  children:
    my-app:
      pipeline:
        observe:
          - datadog-importer
      outputs:
        # Data point 1: us-east-1 region
        - timestamp: 2024-05-21T06:00:00.000Z
          duration: 3600
          id: my-app
          cpu/utilization: 34.5
          cloud/region: us-east-1
        - timestamp: 2024-05-21T07:00:00.000Z
          duration: 3600
          id: my-app
          cpu/utilization: 28.2
          cloud/region: us-east-1
        # Data point 2: us-west-2 region
        - timestamp: 2024-05-21T06:00:00.000Z
          duration: 3600
          id: my-app
          cpu/utilization: 42.1
          cloud/region: us-west-2
        - timestamp: 2024-05-21T07:00:00.000Z
          duration: 3600
          id: my-app
          cpu/utilization: 38.7
          cloud/region: us-west-2
```


#### Typescript

To run the `datadog-importer` in typescript, an instance of `DatadogImporterPlugin` must be created. Then, the plugin's `execute()` method can be called, passing required arguments to it.

```typescript
async function runPlugin() {
  const config = {
    'raw-query': 'exclude_null((sum:kubernetes.cpu.usage.total{env:<env>,project:<id>} by {kube_node_region}.rollup(3600) / 1000000000) / sum:kubernetes.cpu.requests{env:<env>,project:<id>} by {kube_node_region}.rollup(3600) * 100)',
    'output-metric-name': 'cpu/utilization',
    'aggregation-tags': 'kube_node_region',
    'aggregation-tag-output-names': 'cloud/region',
    'env': 'prod'
  }
  const datadogImporter = await new DatadogImporter(config);
  const usage = await datadogImporter.execute([
    {
      timestamp: '2024-05-21T06:00:00Z',
      duration: 14400,
      id: 'my-app'
    },
  ]);

  console.log(usage);
}

runPlugin();
```

## Development

### Testing model integration using local links
For using the locally developed model, please follow these steps: 

1. On the root level of a locally developed model run `npm link`, which will create global package. It uses `package.json` file's `name` field as a package name. Additionally, name can be checked by running `npm ls -g --depth=0 --link=true`.
2. Use the linked model in impl by specifying `name`, `method`, `path` in initialize models section. 

```yaml
name: plugin-demo-link
description: loads plugin
tags: null
initialize:
  plugins:
    my-custom-plugin:
      method: DatadogImporter
      path: 'datadog-importer'
      config:
        ...
...
```

After each change, run `npm run build` to update the model.
