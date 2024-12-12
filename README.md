# MULTI-ROUND BETTING CONTRACT

![RAID](https://github.com/inudotgames/raid-multi-round-betting-contract/blob/master/raid-banner.png?raw=true)


## Introduction

This is a smart contract that allows for multi-round betting on the outcome of a raid in the game $RAID.

In the Elon Raids Mars game ($RAID), we utilize two AI agents to coordinate the game. Every hour there is an attack (a rocket is sent to Mars or an UFO strikes Earth). Players can bet on the outcome of the raid. The raid can be successful or unsuccessful. The odds of success are determined by the random, verifiable numbers. Players can purchase boosts to increase the attack or defense of their team. AI Agents can influence of each raid, so players have to come up with social strategies to win the game.

The contract allows for multi-round betting on the outcome of the raid. Players can bet on the outcome of the raid for the next round. The contract will automatically pay out the winners of the previous round and allow for new bets to be placed.

There are two contracts included in this repository: one for betting using ERC20 tokens and one for betting using ETH.

## Usage

Install npm packages:
```
npm i
```

Compile the contract:
```
npx hardhat compile
```

Run the tests:
```
npx hardhat test
```

Deploy:
```
# TODO
```

## Resources

Web: ElonRaidsMars.com
TG: t.me/elonraidsmars
X: x.com/elonraidsmars

## License

MIT