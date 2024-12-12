// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MultiRoundBettingETH is Ownable, ReentrancyGuard {
    uint256 public ownerFee; // fee in basis points
    uint256 public currentRound;

    struct Round {
        bool bettingOpen;
        bool settled;
        bool winnerA;
        uint256 totalStakedA; // Net staked (after fee)
        uint256 totalStakedB; // Net staked (after fee)
        uint256 totalFees;    // Fees collected this round
    }

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => uint256)) public stakes; // net stake per round per user
    mapping(uint256 => mapping(address => bool)) public betOnA;
    mapping(uint256 => mapping(address => bool)) public participated;

    // payoutRatio: scaled by 1e18 for precision.
    // If winners and losers exist: ratio = (winnersPool+losersPool)*1e18 / winnersPool
    // If no winners or no losers: ratio = 1e18
    mapping(uint256 => uint256) public payoutRatio;

    // track if user claimed a round
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(address => uint256) public lastClaimedRound;

    // Track if fees claimed for a round
    mapping(uint256 => bool) public feesClaimed;
    uint256 public lastClaimedFeeRound;

    constructor(uint256 _fee) Ownable(msg.sender) {
        ownerFee = _fee;
        currentRound = 1;
        rounds[currentRound].bettingOpen = true;
    }

    receive() external payable {
        // fallback: do nothing or revert?
        revert("Use deposit()");
    }

    function startNewRound() external onlyOwner {
        require(rounds[currentRound].settled, "Prev not settled");
        currentRound++;
        rounds[currentRound].bettingOpen = true;
    }

    function deposit(bool onA) external payable nonReentrant {
        uint256 amount = msg.value;
        require(amount > 0, "Zero deposit");
        Round storage r = rounds[currentRound];
        require(r.bettingOpen, "Closed");

        uint256 prev = stakes[currentRound][msg.sender];
        if (prev > 0) {
            require(betOnA[currentRound][msg.sender] == onA, "Team switch");
        }

        // Calculate immediate fee
        uint256 fee = (amount * ownerFee) / 10000;
        uint256 netStake = amount - fee;

        stakes[currentRound][msg.sender] += netStake;
        if (!participated[currentRound][msg.sender]) {
            participated[currentRound][msg.sender] = true;
        }
        betOnA[currentRound][msg.sender] = onA;
        if (onA) r.totalStakedA += netStake; else r.totalStakedB += netStake;
        r.totalFees += fee;
    }

    function closeBetting() external onlyOwner {
        rounds[currentRound].bettingOpen = false;
    }

    // Settle bet without iterating over all participants:
    // If no winners or no losers: ratio = 1e18 (just stake back for winners or everyone)
    // Otherwise: ratio = ((winnersPool + losersPool) * 1e18) / winnersPool
    function settleBet(bool _winnerA) external onlyOwner {
        Round storage r = rounds[currentRound];
        require(!r.settled, "Settled");
        r.settled = true;
        r.winnerA = _winnerA;

        uint256 winnersPool = _winnerA ? r.totalStakedA : r.totalStakedB;
        uint256 losersPool = _winnerA ? r.totalStakedB : r.totalStakedA;

        if (winnersPool == 0 || losersPool == 0) {
            payoutRatio[currentRound] = 1e18;
        } else {
            payoutRatio[currentRound] = ((winnersPool + losersPool) * 1e18) / winnersPool;
        }
    }

    // Users claim all settled rounds since lastClaimedRound
    // Calculation is on-the-fly using payoutRatio
    function claimAllWinnings() external nonReentrant {
        uint256 start = lastClaimedRound[msg.sender] + 1;
        uint256 totalTransfer;
        for (uint256 i = start; i <= currentRound; i++) {
            Round memory r = rounds[i];
            if (!r.settled) break;
            if (claimed[i][msg.sender]) continue;
            uint256 st = stakes[i][msg.sender];
            if (st == 0) continue;
            bool won = (r.winnerA && betOnA[i][msg.sender]) || (!r.winnerA && !betOnA[i][msg.sender]);
            uint256 ratio = payoutRatio[i];

            uint256 payout;
            if (ratio == 1e18) {
                // If ratio=1e18 and no losers => winners get stake
                // If ratio=1e18 and no winners => everyone gets stake
                // If ratio=1e18 because no losers: winners get st
                // If ratio=1e18 because no winners: everyone gets st
                // If ratio=1e18 and user is loser in normal scenario, they'd get nothing.
                // But ratio=1e18 happens only if no losers or no winners. 
                // - no winners => everyone is treated as "stake back"
                // - no losers => winners get stake back
                // In either scenario, losers do not exist or no winners scenario gives everyone stake.
                // Check conditions:
                if (r.totalStakedA == 0 || r.totalStakedB == 0) {
                    // no winners scenario => everyone gets stake
                    payout = st;
                } else if (won) {
                    // no losers scenario => winners get stake
                    payout = st;
                } else {
                    // If ratio=1e18 due to no losers scenario and user didn't win, it means user didn't bet?
                    // Actually if no losers scenario and user not on winner side is impossible since all on same side.
                    payout = 0;
                }
            } else {
                // normal scenario
                if (!won) {
                    payout = 0;
                } else {
                    payout = (st * ratio) / 1e18;
                }
            }

            if (payout > 0) {
                claimed[i][msg.sender] = true;
                totalTransfer += payout;
            }
        }
        require(totalTransfer > 0, "Nothing");
        (bool success, ) = msg.sender.call{value: totalTransfer}("");
        require(success, "ETH transfer failed");
        lastClaimedRound[msg.sender] = currentRound;
    }

    // Owner claims all fees from settled rounds since lastClaimedFeeRound
    // Fees were collected at deposit time and stored in totalFees per round
    function withdrawAllFees() external onlyOwner nonReentrant {
        uint256 start = lastClaimedFeeRound + 1;
        uint256 totalFees;
        for (uint256 i = start; i <= currentRound; i++) {
            Round memory r = rounds[i];
            if (!r.settled) break; 
            if (feesClaimed[i]) continue;
            if (r.totalFees > 0) {
                feesClaimed[i] = true;
                totalFees += r.totalFees;
            }
        }
        require(totalFees > 0, "No fees");
        lastClaimedFeeRound = currentRound;
        (bool success, ) = msg.sender.call{value: totalFees}("");
        require(success, "ETH transfer failed");
    }
}
