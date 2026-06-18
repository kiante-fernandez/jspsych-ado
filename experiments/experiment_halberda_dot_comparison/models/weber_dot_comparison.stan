data {
  int<lower=1> N;                         // number of response trials
  array[N] int<lower=0, upper=1> correct; // 1 = correct, 0 = incorrect

  array[N] int<lower=1> n_blue;           // number of blue dots
  array[N] int<lower=1> n_yellow;         // number of yellow dots
}

parameters {
  real<lower=0> w;                        // Weber fraction
}

transformed parameters {
  vector<lower=0, upper=1>[N] p_correct;

  for (i in 1:N) {
    real n_large = max(n_blue[i], n_yellow[i]);
    real n_small = min(n_blue[i], n_yellow[i]);
    real delta = n_large - n_small;
    real sigma_delta = w * sqrt(square(n_large) + square(n_small));

    p_correct[i] = Phi(delta / sigma_delta);
  }
}

model {
  // Prior centered near the value often used as a starting ANS acuity estimate.
  w ~ lognormal(log(0.25), 0.5);

  correct ~ bernoulli(p_correct);
}

generated quantities {
  vector[N] log_lik;
  array[N] int correct_rep;

  for (i in 1:N) {
    log_lik[i] = bernoulli_lpmf(correct[i] | p_correct[i]);
    correct_rep[i] = bernoulli_rng(p_correct[i]);
  }
}
