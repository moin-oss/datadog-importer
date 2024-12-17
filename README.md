# datadog-importer

The `datadog-importer` plugin fetches metrics from Datadog for use in Impact Framework calculations.

## Implementation

The `datadog-importer` plugin fetches metrics from Datadog and formats them for use in Impact Framework calculations. The plugin is highly configurable. It can fetch one or more metrics, based on an arbitrary identifier, adding any number of tags to the output.

The plugin can also break down each input time window into multiple slices, allowing users to collect fine-grained metrics with minimal input.

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

#### Global
* `id-tag`: The key of the tag in Datadog that is used to uniquely identify the unit represented by each input
* `metrics`: Comma separated list of metrics to fetch for each input. Each item in the list is the metric name in Datadog
* `output-metric-names`: Comma separated list of metric names to use in the output. Each item in the list corresponds to the item in `metrics` at the same index. This allows users to rename metrics when subsequent stages expect different names than the ones used in Datadog
* `tags`: Comma separated list of tags to add to each output. Each item is the key of a tag in Datadog.
* `output-tag-names`: Comma separated list of tag names to use in the output. Each item in the list corresponds to the item in `tags` at the same index. This allows users to rename tags when subsequent stages expect different names than the ones used in Datadog

#### Node-level
There is no node-level configuration.

### Inputs
* `timestamp`: An ISO8601 timestamp indicating the start time of the observation period
* `duration`: Number of seconds in the observation period. We compute the end time by adding this number to `timestamp`
* `duration-rollup`: Number of seconds in each output slice. We break each input into `N` outputs where `N = duration / duration-rollup` and the duration of each output is `duration-rollup`
* `id`: The value of the tag in Datadog that uniquely identifies the unit represented by the input

### Outputs
One of the key features of this plugin is that one input can be expanded into many outputs. 

First, the input is expanded by time. The observation window (defined by `timestamp` and `duration`) is split into `N` slices where `N = duration / duration-rollup`.

The input is expanded for each combination of tag values available for the input unit. If there are `M` combinations of tag values, the input is expanded into `M * N` outputs. Each output will have the following fields:
* `timestamp`: An ISO8601 timestamp indicating the start time of one of the `N` slices of the observation window
* `duration`: Number of seconds in the slice of the observation window. This will be the value of `duration-rollup` from the input
* `<TAG 1>`, `<TAG 2>`, `<TAG X>`: Key value pairs specifying one of the `M` combinations of tag values. The key is the name as defined by `output-tag-names` configuration
* `<METRIC 1>`, `<METRIC 2>` ... `<METRIC Y>`: Key value pairs for each metric specified in `metrics`. The key is the name as defined by `output-metric-names` configuration

### Grouping
The output of this plugin is a one dimensional array at the level of the input. If your ouput contains of multiple tag combinations, you may want to regroup on the tags. Grouping is a native functinality of the Impact Framework and is [documented here](https://if.greensoftware.foundation/major-concepts/manifest-file/#regrouping-a-manifest-file).

### Examples

#### Manifest
Consider the following input manifest file:
```yaml
name: datadog-importer-example
description: A sample manifest file demonstrating usage of the datadog-importer plugin
initialize:
  plugins:
    datadog-importer: 
      path: 'https://github.com/moin-oss/datadog-importer'
      method: DatadogImporter
      config:
        id-tag: application
        metrics: runtime.cpu.util,runtime.mem.requests
        output-metric-names: cpu/utilization,memory/available/GB
        tags: region,instance-type
        output-tag-names: cloud/region,cloud/instance-type
tree:
  children:
    my-app:
      pipeline:
        observe:
          - datadog-importer
      inputs:
        - timestamp: 2024-05-21T06:00
          duration: 1800
          duration-rollup: 900
          id: my-app
```
In this scenario, we are collecting the CPU utilization and memory requests of `my-app` over the 30 minutes starting at 6:00 AM UTC on May 21, 2024. The plugin is configured to generate two 15 minute slices for each combination of cloud region and instance type. 

Assume CPU utilization is a metric in Datadog named `runtime.cpu.util` and memory requests is a metric in Datadog named `runtime.mem.requests`. Assume that `my-app` is deployed onto instances of type `a1-large` and `b2-small` in cloud regions `us-east-1` and `us-west-2`. Therefore, both metrics have 4 time series, one for each combination of cloud region and instance type, tagged as follows:
* `application:my-app`, `region:us-east-1`, `instance-type:a1-large`
* `application:my-app`, `region:us-east-1`, `instance-type:b2-small`
* `application:my-app`, `region:us-west-2`, `instance-type:a1-large`
* `application:my-app`, `region:us-west-2`, `instance-type:b2-small`

Then, the output will be (comments added for emphasis):
```yaml
tree:
  children:
    my-app:
      pipeline:
        observe:
          - datadog-importer
      outputs:
        # Time series: `region:us-east-1`, `instance-type:a1-large`
        - timestamp: 2024-05-21T06:00
          duration: 900
          duration-rollup: 900
          id: my-app
          cpu/utilization: 34
          memory/available/GB: 2
          cloud/region: us-east-1
          cloud/instance-type: a1-large
        - timestamp: 2024-05-21T06:15
          duration: 900
          duration-rollup: 900
          id: my-app
          cpu/utilization: 23
          memory/available/GB: 2
          cloud/region: us-east-1
          cloud/instance-type: a1-large
        # Time series: `region:us-east-1`, `instance-type:b2-small`
        - timestamp: 2024-05-21T06:00
          duration: 900
          duration-rollup: 900
          id: my-app
          cpu/utilization: 76
          memory/available/GB: 1
          cloud/region: us-east-1
          cloud/instance-type: b2-small
        - timestamp: 2024-05-21T06:15
          duration: 900
          duration-rollup: 900
          id: my-app
          cpu/utilization: 87
          memory/available/GB: 1
          cloud/region: us-east-1
          cloud/instance-type: b2-small
        # Time series: `region:us-west-2`, `instance-type:a1-large`
        - timestamp: 2024-05-21T06:00
          duration: 900
          duration-rollup: 900
          id: my-app
          cpu/utilization: 25
          memory/available/GB: 4
          cloud/region: us-west-2
          cloud/instance-type: a1-large
        - timestamp: 2024-05-21T06:15
          duration: 900
          duration-rollup: 900
          id: my-app
          cpu/utilization: 12
          memory/available/GB: 4
          cloud/region: us-west-2
          cloud/instance-type: a1-large
        # Time series: `region:us-west-2`, `instance-type:b2-small`
        - timestamp: 2024-05-21T06:00
          duration: 900
          duration-rollup: 900
          id: my-app
          cpu/utilization: 43
          memory/available/GB: 1
          cloud/region: us-west-2
          cloud/instance-type: b2-small
        - timestamp: 2024-05-21T06:15
          duration: 900
          duration-rollup: 900
          id: my-app
          cpu/utilization: 54
          memory/available/GB: 1
          cloud/region: us-west-2
          cloud/instance-type: b2-small
```


#### Typescript

To run the `datadog-importer` in typescript, an instance of `DatadogImporterPlugin` must be created. Then, the plugin's `execute()` method can be called, passing required arguments to it.

```typescript
async function runPlugin() {
  const config = {
    'id-tag': 'application',
    metrics: 'runtime.cpu.util,runtime.mem.requests',
    'output-metric-names': 'cpu/utilization,memory/available/GB',
    tags: 'region,instance-type',
    'output-tag-names': 'cloud/region,cloud/instance-type'
  }
  const datadogImporter = await new DatadogImporter(config);
  const usage = await datadogImporter.execute([
    {
      timestamp: '2021-01-01T00:00:00Z',
      duration: 1800,
      'duration-rollup': 900,
      'id': 'my-app'
    },
  ]);

  console.log(usage);
}

runPlugin();
```

## Development

### Testing model integration using local links
For using the locally developed model, please follow these steps: 

1. On the root level of a locally developed model run `npm link`, which will create global package. It uses `package.json` file's `name` field as a package name. Additionally name can be checked by running `npm ls -g --depth=0 --link=true`.
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
