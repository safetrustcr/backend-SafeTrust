Feature: dc_prep safetrust — phase timing baseline

  Background:
    * def fs = Java.type('java.nio.file.Files')
    * def path = Java.type('java.nio.file.Paths').get('tests/results/dc-prep-timings.json')
    * def timings = karate.fromString(new java.lang.String(fs.readAllBytes(path)))

  Scenario: All expected safetrust phases are present in the timing report
    Then match timings contains
    """
    {
      docker_up: '#number',
      hasura_health: '#number',
      metadata_deploy_safetrust: '#number',
      migrations_safetrust: '#number',
      metadata_reload: '#number',
      seeds_safetrust: '#number',
      total: '#number'
    }
    """

  Scenario: No individual phase exceeds 120 seconds
    * def phases = karate.keysOf(timings)
    * def slowPhases = karate.filter(phases, function(k){ return timings[k] > 120 && k != 'total' })
    Then match slowPhases == []

  Scenario: Timing report is written to the expected output path
    * def file = new java.io.File('tests/results/dc-prep-timings.json')
    Then assert file.exists()
